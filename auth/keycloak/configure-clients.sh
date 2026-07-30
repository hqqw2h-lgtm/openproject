#!/usr/bin/env bash
set -euo pipefail

KCADM=/opt/keycloak/bin/kcadm.sh
KCADM_CONFIG=/tmp/amperun-kcadm.config
REALM=amperun
FLOW_ALIAS=wecom-only-browser

BRIDGE_ISSUER="${BRIDGE_ISSUER%/}"
KEYCLOAK_PUBLIC_URL="${KEYCLOAK_PUBLIC_URL%/}"
OPENPROJECT_PUBLIC_URL="${OPENPROJECT_PUBLIC_URL%/}"
expected_broker_redirect_uri="${KEYCLOAK_PUBLIC_URL}/realms/${REALM}/broker/wecom/endpoint"

if [[ "${WECOM_MODE:-mock}" == "wecom" ]]; then
  for url_name in BRIDGE_ISSUER KEYCLOAK_PUBLIC_URL OPENPROJECT_PUBLIC_URL KEYCLOAK_BROKER_REDIRECT_URI; do
    url_value="${!url_name:-}"
    if [[ "${url_value}" != https://* ]]; then
      echo "${url_name} must use HTTPS in real WeCom mode" >&2
      exit 1
    fi
  done
  for secret_name in KEYCLOAK_BROKER_CLIENT_SECRET OPENPROJECT_OIDC_CLIENT_SECRET; do
    secret_value="${!secret_name:-}"
    if [[ -z "${secret_value}" || "${secret_value}" == *local* || "${secret_value}" == *change-me* ]]; then
      echo "${secret_name} must not use a local placeholder in real WeCom mode" >&2
      exit 1
    fi
  done
fi

if [[ "${KEYCLOAK_BROKER_REDIRECT_URI}" != "${expected_broker_redirect_uri}" ]]; then
  echo "KEYCLOAK_BROKER_REDIRECT_URI must equal ${expected_broker_redirect_uri}" >&2
  exit 1
fi

"${KCADM}" config credentials \
  --config "${KCADM_CONFIG}" \
  --server http://keycloak:8080 \
  --realm master \
  --user "${KEYCLOAK_ADMIN}" \
  --password "${KEYCLOAK_ADMIN_PASSWORD}" >/dev/null

client_uuid="$("${KCADM}" get clients \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -q clientId=openproject \
  --fields id \
  --format csv \
  --noquotes)"

if [[ -z "${client_uuid}" || "${client_uuid}" == *$'\n'* ]]; then
  echo "Unable to resolve exactly one openproject client" >&2
  exit 1
fi

"${KCADM}" update "clients/${client_uuid}" \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -s "secret=${OPENPROJECT_OIDC_CLIENT_SECRET}" \
  -s "redirectUris=[\"${OPENPROJECT_PUBLIC_URL}/auth/keycloak/callback\"]" \
  -s "webOrigins=[\"${OPENPROJECT_PUBLIC_URL}\"]" \
  -s "attributes={\"post.logout.redirect.uris\":\"${OPENPROJECT_PUBLIC_URL}/*\"}"

"${KCADM}" update identity-provider/instances/wecom \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -s "config.clientSecret=${KEYCLOAK_BROKER_CLIENT_SECRET}" \
  -s "config.authorizationUrl=${BRIDGE_ISSUER}/auth" \
  -s "config.tokenUrl=${BRIDGE_ISSUER}/token" \
  -s "config.userInfoUrl=${BRIDGE_ISSUER}/userinfo" \
  -s "config.logoutUrl=${BRIDGE_ISSUER}/session/end" \
  -s "config.issuer=${BRIDGE_ISSUER}" \
  -s "config.jwksUrl=${BRIDGE_ISSUER}/jwks"

flow_uuid=""
while IFS=, read -r candidate_uuid candidate_alias; do
  if [[ "${candidate_alias}" == "${FLOW_ALIAS}" ]]; then
    if [[ -n "${flow_uuid}" ]]; then
      echo "Multiple ${FLOW_ALIAS} authentication flows found" >&2
      exit 1
    fi
    flow_uuid="${candidate_uuid}"
  fi
done < <("${KCADM}" get authentication/flows \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  --fields id,alias \
  --format csv \
  --noquotes)

if [[ -z "${flow_uuid}" ]]; then
  "${KCADM}" create authentication/flows \
    --config "${KCADM_CONFIG}" \
    -r "${REALM}" \
    -s "alias=${FLOW_ALIAS}" \
    -s providerId=basic-flow \
    -s topLevel=true \
    -s builtIn=false >/dev/null
fi

execution_uuid=""
authentication_config_uuid=""
while IFS=, read -r candidate_uuid provider_id _requirement candidate_config_uuid; do
  if [[ "${provider_id}" == "identity-provider-redirector" ]]; then
    if [[ -n "${execution_uuid}" ]]; then
      echo "Multiple Identity Provider Redirectors found in ${FLOW_ALIAS}" >&2
      exit 1
    fi
    execution_uuid="${candidate_uuid}"
    authentication_config_uuid="${candidate_config_uuid}"
  fi
done < <("${KCADM}" get "authentication/flows/${FLOW_ALIAS}/executions" \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  --fields id,providerId,requirement,authenticationConfig \
  --format csv \
  --noquotes)

if [[ -z "${execution_uuid}" ]]; then
  "${KCADM}" create "authentication/flows/${FLOW_ALIAS}/executions/execution" \
    --config "${KCADM_CONFIG}" \
    -r "${REALM}" \
    -s provider=identity-provider-redirector >/dev/null
  while IFS=, read -r candidate_uuid provider_id _requirement candidate_config_uuid; do
    if [[ "${provider_id}" == "identity-provider-redirector" ]]; then
      execution_uuid="${candidate_uuid}"
      authentication_config_uuid="${candidate_config_uuid}"
    fi
  done < <("${KCADM}" get "authentication/flows/${FLOW_ALIAS}/executions" \
    --config "${KCADM_CONFIG}" \
    -r "${REALM}" \
    --fields id,providerId,requirement,authenticationConfig \
    --format csv \
    --noquotes)
fi

if [[ -z "${execution_uuid}" || "${execution_uuid}" == *$'\n'* ]]; then
  echo "Unable to resolve exactly one Identity Provider Redirector" >&2
  exit 1
fi

"${KCADM}" update "authentication/flows/${FLOW_ALIAS}/executions" \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -n \
  -s "id=${execution_uuid}" \
  -s requirement=REQUIRED

if [[ -z "${authentication_config_uuid}" ]]; then
  "${KCADM}" create "authentication/executions/${execution_uuid}/config" \
    --config "${KCADM_CONFIG}" \
    -r "${REALM}" \
    -s alias=wecom-default \
    -s config.defaultProvider=wecom >/dev/null
else
  "${KCADM}" update "authentication/config/${authentication_config_uuid}" \
    --config "${KCADM_CONFIG}" \
    -r "${REALM}" \
    -n \
    -s alias=wecom-default \
    -s config.defaultProvider=wecom
fi

"${KCADM}" update "realms/${REALM}" \
  --config "${KCADM_CONFIG}" \
  -s "browserFlow=${FLOW_ALIAS}"

account_console_uuid="$("${KCADM}" get clients \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -q clientId=account-console \
  --fields id \
  --format csv \
  --noquotes)"

if [[ -z "${account_console_uuid}" || "${account_console_uuid}" == *$'\n'* ]]; then
  echo "Unable to resolve exactly one account-console client" >&2
  exit 1
fi

"${KCADM}" update "clients/${account_console_uuid}" \
  --config "${KCADM_CONFIG}" \
  -r "${REALM}" \
  -s enabled=false

echo "Keycloak client secrets reconciled; WeCom-only browser flow enforced"
