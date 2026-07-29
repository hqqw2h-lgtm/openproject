SHELL := /bin/sh
AUTH_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
WORKSPACE_DIR := $(abspath $(AUTH_DIR)/..)
ENV_FILE ?= $(AUTH_DIR)/.env
AUTH_COMPOSE := $(AUTH_DIR)/docker-compose.yml
OPENPROJECT_DIR ?= $(WORKSPACE_DIR)
OPENPROJECT_COMPOSE := $(OPENPROJECT_DIR)/docker/poc/wecom-sso/docker-compose.yml
PROJECT_NAME ?= amperun-sso-fork
COMPOSE := env OPENPROJECT_SOURCE_DIR=$(OPENPROJECT_DIR) docker-compose --env-file $(ENV_FILE) -p $(PROJECT_NAME) -f $(AUTH_COMPOSE) -f $(OPENPROJECT_COMPOSE)

.PHONY: up wait down destroy reset status logs deps test smoke config

$(ENV_FILE):
	cp $(AUTH_DIR)/.env.example $(ENV_FILE)

up: $(ENV_FILE)
	$(COMPOSE) up -d --build --wait --wait-timeout 300
	node $(AUTH_DIR)/bridge/scripts/wait-for-stack.mjs

wait: $(ENV_FILE)
	node $(AUTH_DIR)/bridge/scripts/wait-for-stack.mjs

down: $(ENV_FILE)
	$(COMPOSE) down --remove-orphans

destroy: $(ENV_FILE)
	$(COMPOSE) down --volumes --remove-orphans

reset: destroy up

status: $(ENV_FILE)
	$(COMPOSE) ps --all

logs: $(ENV_FILE)
	$(COMPOSE) logs --tail=200 -f

deps:
	cd $(AUTH_DIR)/bridge && npm ci

test: deps
	cd $(AUTH_DIR)/bridge && npm test

smoke: $(ENV_FILE)
	STACK_COMPOSE_PROJECT=$(PROJECT_NAME) node $(AUTH_DIR)/bridge/scripts/runtime-smoke.mjs
	STACK_COMPOSE_PROJECT=$(PROJECT_NAME) node $(AUTH_DIR)/bridge/scripts/network-smoke.mjs

config: $(ENV_FILE)
	$(COMPOSE) config --quiet
