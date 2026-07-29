# Amperun 企业微信统一登录

这个目录提供可删除、可重建的本地 Docker 验证环境。当前 OpenProject 登录链路是：

```text
企业微信 -> Bridge -> Keycloak -> OpenProject 原生 OIDC
```

Bridge 把企业微信身份转换成标准 OIDC；Keycloak 作为统一身份中心，可继续为 GitLab
等平台增加独立 OIDC Client；OpenProject 使用仓库自带的 OIDC Provider，不再依赖外置
登录网关。

## 代码位置

| 内容 | 路径 |
| --- | --- |
| Docker 编排入口 | `auth/docker-compose.yml` |
| 企业微信 OIDC Bridge | `auth/bridge/` |
| Keycloak Realm | `auth/keycloak/amperun-realm.json` |
| Keycloak Secret 与 Browser Flow 对账 | `auth/keycloak/configure-clients.sh` |
| 本地反向代理 | `auth/proxy/Caddyfile` |
| OpenProject 部署覆盖 | `docker/poc/wecom-sso/docker-compose.yml` |
| 企业微信管理员操作 | `auth/docs/wecom-admin-setup.md` |

## 本地启动

需要 Docker Desktop、`docker-compose`、Node.js 22+。在仓库根目录执行：

```bash
cp auth/.env.example auth/.env
make -C auth test
make -C auth config
make -C auth up
```

默认 `WECOM_MODE=mock`，无需真实企业微信 Secret。服务入口：

- OpenProject：`http://openproject.localhost:8090/`
- Keycloak 管理后台：`http://keycloak.localhost:8090/admin`
- Bridge Discovery：`http://bridge.localhost:8090/.well-known/openid-configuration`

首次打开 OpenProject 的登录页，点击“企业微信”。Keycloak 会强制跳转到 Bridge；Mock
模式选择 Alice 或 Bob 后回到 OpenProject。不要从 Keycloak 的 `/account` 页面开始登录，
该页面不是业务系统入口，并且本地 Realm 已禁用员工 Account Console。

停止服务不会删除数据：

```bash
make -C auth down
```

删除全部本地容器和数据卷：

```bash
make -C auth destroy
```

修改 Client Secret、公开域名或 OIDC 回调后，直接重新执行 `make -C auth up`。一次性
`keycloak-client-config` 会把这些运行参数对账到已有 Realm，不需要删除 Keycloak 用户。

Keycloak Realm JSON 只在数据库首次初始化时导入。如果修改了无法在线迁移的 Realm 结构，
并且确认整套本地数据都可以删除，使用：

```bash
make -C auth reset
```

`reset` 会删除当前 Compose 项目的所有数据卷后重建。项目不提供只删除 Keycloak 数据卷的
快捷入口，因为那会改变 Keycloak 用户 `sub`，使 OpenProject 已保存的身份链接失效或依赖
高风险的登录名重映射。

## 员工是否需要预先建号

不需要管理员预先在 Keycloak 或 OpenProject 添加员工。真实模式下员工必须同时满足：

1. 已在企业微信通讯录中启用；
2. 位于自建应用可见范围；
3. `UserID` 位于 `WECOM_ALLOWED_USER_IDS`；
4. 企业微信返回唯一且有效的企业邮箱。

第一次成功登录时，Bridge 建立稳定的 `CorpID + UserID -> personId` 映射，Keycloak
创建 Broker 用户，OpenProject 再通过 OIDC 自动创建并激活用户。`personId` 生成的
`sub` 和登录名不会因为姓名或邮箱修改而变化。

当前 PoC 没有实现企业微信成员变更事件和定期全量对账。员工离职后，管理员仍需及时
移出应用可见范围和 `WECOM_ALLOWED_USER_IDS`，并在 Keycloak/OpenProject 停用已有会话或
账号。生产环境应补齐自动停用流程。

## 配置与 Secret

真实企业微信联调需要在 `auth/.env` 设置：

```dotenv
WECOM_MODE=wecom
WECOM_AUTH_STYLE=qr
WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
WECOM_AGENT_ID=1000002
WECOM_APP_SECRET=<secret-manager-reference>
WECOM_ALLOWED_USER_IDS=zhangsan,lisi
BRIDGE_ISSUER=https://sso.example.com
BRIDGE_PUBLIC_HOST=sso.example.com
KEYCLOAK_PUBLIC_URL=https://login.example.com
KEYCLOAK_PUBLIC_HOST=login.example.com
KEYCLOAK_BROKER_REDIRECT_URI=https://login.example.com/realms/amperun/broker/wecom/endpoint
OPENPROJECT_PUBLIC_URL=https://projects.example.com
OPENPROJECT_PUBLIC_HOST=projects.example.com
OPENPROJECT_GATEWAY_HOST=projects.example.com
OPENPROJECT_COLLABORATION_PUBLIC_URL=wss://projects.example.com/hocuspocus
```

另外必须分别生成随机值：

- `BRIDGE_COOKIE_KEYS`
- `KEYCLOAK_BROKER_CLIENT_SECRET`
- `OPENPROJECT_OIDC_CLIENT_SECRET`
- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `OPENPROJECT_DB_PASSWORD`
- `OPENPROJECT_SECRET_KEY_BASE`
- `COLLABORATIVE_SERVER_SECRET`

`keycloak-client-config` 一次性容器会把两个 Client Secret、Bridge IdP 端点和 OpenProject
回调/Origin 对账到已经导入的 Realm，并强制 `wecom-only-browser` 流程。修改这些值后重新
执行 `make up`，再用 `make status` 检查该容器退出码为 `0`。

不要把真实 Secret 写入 Compose、Realm JSON、文档或 Git。`.env` 已被忽略，但仍应只
保存本地临时值；生产部署从 Secret Manager 注入。

## OIDC 与网络边界

OpenProject Provider slug 和 Keycloak Client ID 都是 `keycloak` / `openproject`。本地回调为：

```text
http://openproject.localhost:8090/auth/keycloak/callback
```

浏览器必须看到 Keycloak 的公开 issuer 和授权、退出地址；OpenProject 容器通过私有
`openproject-idp-backplane` 访问 token、userinfo 和 JWKS 端点。Bridge 与 `op-web` 不共享
Docker network，外部只暴露 Gateway 的 `127.0.0.1:8090`。

本地环境使用 HTTP 和开发密码，只适合功能验证。`WECOM_MODE=wecom` 会拒绝 HTTP URL、
缺失值和本地占位 Secret。真实联调必须使用 HTTPS、受控域名、强随机 Secret、固定出口
IP、数据库备份、审计告警和独立紧急管理员入口。同机反向代理可以继续转发到仅绑定
`127.0.0.1:8090` 的 Gateway。

## 验证

```bash
make -C auth test
make -C auth coverage
make -C auth config
make -C auth smoke
```

`test` 验证 Bridge 和跨目录契约；`coverage` 对 Bridge `src` 的每个文件及整体汇总分别强制
行、分支和函数覆盖率均不低于 95%；`config` 验证合并后的 Compose；`smoke` 在运行栈上验证
OIDC 重定向、Keycloak issuer、OpenProject Provider metadata、协作编辑路由和网络边界。

GitLab 尚未加入这个本地 Compose。接入时应在同一 Realm 新建独立 `gitlab` Client，使用
GitLab 原生 OIDC，并为它配置独立回调、Secret 和授权范围，不复用 OpenProject Secret。
