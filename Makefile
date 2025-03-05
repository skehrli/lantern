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

site:
	$(POETRY) run uvicorn lantern.app:app --reload &
	sleep 2
	cd ./frontend && npm run dev &
	sleep 1
	xdg-open http://localhost:5173 || open http://localhost:5173 || start http://localhost:5173

# target to install dependencies
install:
	$(POETRY) install

# target to clean up
clean:
	rm -rf __pycache__
	rm -rf .mypy_cache
