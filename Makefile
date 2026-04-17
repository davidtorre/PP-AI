.PHONY: help build up down restart logs seed reset ps shell-backend shell-db

# ─── PP-AI — Comandos locales (Docker Desktop) ───────────────────────────────

help: ## Mostrar esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

build: ## Construir las imágenes desde el código fuente
	docker compose build

up: ## Levantar todos los servicios (build si no existen las imágenes)
	docker compose up -d --build
	@echo ""
	@echo "  ✅ App disponible en → http://localhost"
	@echo "  🔌 API directa       → http://localhost:3003/api/health"
	@echo "  🐘 Postgres          → localhost:5435 (user: ppai)"
	@echo ""

down: ## Detener y eliminar los contenedores (los volúmenes se conservan)
	docker compose down

restart: ## Reiniciar todos los servicios
	docker compose restart

logs: ## Ver logs de todos los servicios en tiempo real
	docker compose logs -f

logs-backend: ## Ver logs solo del backend
	docker compose logs -f backend

logs-db: ## Ver logs solo de la base de datos
	docker compose logs -f database

ps: ## Ver estado de los contenedores
	docker compose ps

seed: ## Cargar datos de ejemplo en la BD (usuarios de prueba)
	@echo "Cargando datos de ejemplo..."
	docker compose exec backend node dist/db/seed.js
	@echo ""
	@echo "  Cuentas creadas:"
	@echo "    admin@app.com  / admin123"
	@echo "    editor@app.com / editor123"
	@echo "    viewer@app.com / viewer123"
	@echo ""

shell-backend: ## Abrir terminal dentro del contenedor del backend
	docker compose exec backend sh

shell-db: ## Abrir psql dentro del contenedor de la BD
	docker compose exec database psql -U ppai -d ppai

reset: ## ⚠ Eliminar contenedores Y volúmenes (borra todos los datos)
	@echo "⚠  Esto eliminará TODOS los datos (BD y uploads)."
	@read -p "   Escribir 'si' para confirmar: " c; [ "$$c" = "si" ] || exit 1
	docker compose down -v
	@echo "✅ Limpieza completa."
