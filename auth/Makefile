SHELL := /bin/sh
AUTH_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WORKSPACE_DIR := $(abspath $(AUTH_DIR)/..)
ENV_FILE ?= $(AUTH_DIR)/.env
AUTH_COMPOSE := $(AUTH_DIR)/docker-compose.yml
OPENPROJECT_DIR ?= $(WORKSPACE_DIR)
OPENPROJECT_COMPOSE := $(OPENPROJECT_DIR)/docker/poc/wecom-sso/docker-compose.yml
PROJECT_NAME ?= amperun-sso-fork
COMPOSE_COMMAND ?= $(shell if docker compose version --short 2>/dev/null | awk -F. '{ sub(/^v/, "", $$1); ok = ($$1 + 0 >= 2) } END { exit !ok }'; then echo 'docker compose'; elif docker-compose version --short 2>/dev/null | awk -F. '{ sub(/^v/, "", $$1); ok = ($$1 + 0 >= 2) } END { exit !ok }'; then echo docker-compose; fi)
COMPOSE := env OPENPROJECT_SOURCE_DIR=$(OPENPROJECT_DIR) $(COMPOSE_COMMAND) --env-file $(ENV_FILE) -p $(PROJECT_NAME) -f $(AUTH_COMPOSE) -f $(OPENPROJECT_COMPOSE)

.PHONY: up wait down destroy reset status logs deps test coverage smoke config compose-preflight source-preflight

$(ENV_FILE):
	cp $(AUTH_DIR)/.env.example $(ENV_FILE)

up: $(ENV_FILE) compose-preflight source-preflight
	$(COMPOSE) up -d --build --wait --wait-timeout 300
	node $(AUTH_DIR)/bridge/scripts/wait-for-stack.mjs

compose-preflight:
	@version="$$($(COMPOSE_COMMAND) version --short 2>/dev/null)"; \
	printf '%s\n' "$$version" | awk -F. '{ sub(/^v/, "", $$1); ok = ($$1 + 0 >= 2) } END { exit !ok }' || \
	  { echo "Docker Compose 2 or newer is required" >&2; exit 1; }

source-preflight:
	bash $(OPENPROJECT_DIR)/docker/prod/setup/validate-source-tree.sh

wait: $(ENV_FILE)
	node $(AUTH_DIR)/bridge/scripts/wait-for-stack.mjs

down: $(ENV_FILE) compose-preflight
	$(COMPOSE) down --remove-orphans

destroy: $(ENV_FILE) compose-preflight
	$(COMPOSE) down --volumes --remove-orphans

reset: destroy up

status: $(ENV_FILE) compose-preflight
	$(COMPOSE) ps --all

logs: $(ENV_FILE) compose-preflight
	$(COMPOSE) logs --tail=200 -f

deps:
	cd $(AUTH_DIR)/bridge && npm ci

test: deps
	cd $(AUTH_DIR)/bridge && npm test

coverage: deps
	cd $(AUTH_DIR)/bridge && npm run test:coverage

smoke: $(ENV_FILE)
	STACK_COMPOSE_PROJECT=$(PROJECT_NAME) node $(AUTH_DIR)/bridge/scripts/runtime-smoke.mjs
	STACK_COMPOSE_PROJECT=$(PROJECT_NAME) node $(AUTH_DIR)/bridge/scripts/network-smoke.mjs

config: $(ENV_FILE) compose-preflight
	$(COMPOSE) config --quiet
