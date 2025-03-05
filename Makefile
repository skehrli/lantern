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
	$(POETRY) run uvicorn lantern.app:app --reload

# target to install dependencies
install:
	$(POETRY) install

# target to clean up
clean:
	rm -rf __pycache__
	rm -rf .mypy_cache
