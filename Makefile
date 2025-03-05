POETRY = poetry

# targets
.PHONY: all format typecheck run

all: format typecheck run

init:
	$(POETRY) install

format:
	$(POETRY) run black ./src/*.py

typecheck:
	$(POETRY) run mypy ./src/*.py

run:
	$(POETRY) run python -m src.main

load:
	$(POETRY) run python -m src.data_loader

site:
	$(POETRY) run uvicorn src.app:app --reload

# target to install dependencies
install:
	$(POETRY) install

# target to clean up
clean:
	rm -rf __pycache__
	rm -rf .mypy_cache
