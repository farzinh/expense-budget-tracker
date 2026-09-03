COMPOSE := docker compose -f infra/docker/compose.yml
DOCKER_ENV := infra/docker/.env

.PHONY: up down migrate dev build lint logs ps

# Compose reads this automatically because it sits beside compose.yml. It is
# gitignored, so a fresh clone seeds it from the tracked template; an existing
# file is never overwritten.
$(DOCKER_ENV):
	cp infra/docker/.env.example $(DOCKER_ENV)
	@echo "Created $(DOCKER_ENV) from infra/docker/.env.example"

up: $(DOCKER_ENV)
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate: $(DOCKER_ENV)
	$(COMPOSE) run --rm migrate

dev: $(DOCKER_ENV)
	$(COMPOSE) up

build: $(DOCKER_ENV)
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

lint:
	cd apps/web && npm run lint
	cd apps/worker && npm run lint
