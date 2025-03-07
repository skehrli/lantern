POETRY = poetry

# targets
.PHONY: all format typecheck run

all: format typecheck run

init:
	$(POETRY) install

format:
	$(POETRY) run black ./lantern/*.py

typecheck:
	$(POETRY) run mypy ./lantern/*.py

run:
	$(POETRY) run python -m lantern.main

load:
	$(POETRY) run python -m lantern.data_loader

back:
	$(POETRY) run uvicorn lantern.app:app --reload

front:
	[ -d "./frontend/node_modules" ] || (cd ./frontend && npm install)
	cd ./frontend && npm run dev

site:
	$(POETRY) run uvicorn lantern.app:app --reload &
	BACKEND_PID=$!
	sleep 2
	[ -d "./frontend/node_modules" ] || (cd ./frontend && npm install)
	cd ./frontend && npm run dev &
	FRONTEND_PID=$!
	sleep 1
	xdg-open http://localhost:5173 || open http://localhost:5173 || start http://localhost:5173
	trap '[[ -n "$$BACKEND_PID" ]] && kill $$BACKEND_PID; [[ -n "$$FRONTEND_PID" ]] && kill $$FRONTEND_PID' EXIT
	wait $$BACKEND_PID $$FRONTEND_PID

# target to install dependencies
install:
	$(POETRY) install

# target to clean up
clean:
	rm -rf __pycache__
	rm -rf .mypy_cache
