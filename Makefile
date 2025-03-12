# Detect OS
ifeq ($(OS),Windows_NT)
  DETECTED_OS := Windows
else
  DETECTED_OS := $(shell uname -s)
endif

# Set Poetry path based on OS
ifeq ($(DETECTED_OS),Windows)
  POETRY_PATH := $(APPDATA)\Python\Scripts\poetry.exe
  POETRY := $(shell if exist "$(POETRY_PATH)" echo "$(POETRY_PATH)")
else
  POETRY := $(shell command -v poetry 2>/dev/null)
endif

# targets
.PHONY: all format typecheck run init back front

all: format typecheck run

init:
ifeq ($(POETRY),)
	@echo "Poetry not found. Installing..."
	
ifeq ($(DETECTED_OS),Windows)
	@echo "Installing Poetry on Windows..."
	@powershell -Command "(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -"
	@echo "Poetry installed. Adding Poetry to PATH..."
	@powershell -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $$env:APPDATA + '\Python\Scripts', 'User')"
	@echo "Running Poetry install..."
	@powershell -Command "& \"$$env:APPDATA\Python\Scripts\poetry.exe\" install"
else ifeq ($(DETECTED_OS),Linux)
	@echo "Installing Poetry on Linux..."
	@curl -sSL https://install.python-poetry.org | python3 -
	@echo "Poetry installed. Adding Poetry to PATH..."
	@export PATH="$$HOME/.local/bin:$$PATH"
	@$$HOME/.local/bin/poetry install
else ifeq ($(DETECTED_OS),Darwin)
	@echo "Installing Poetry on macOS..."
	@curl -sSL https://install.python-poetry.org | python3 -
	@echo "Poetry installed. Adding Poetry to PATH..."
	@export PATH="$$HOME/.local/bin:$$PATH"
	@$$HOME/.local/bin/poetry install
endif

else
	@echo "Poetry found, installing dependencies..."
ifeq ($(DETECTED_OS),Windows)
	@powershell -Command "$(POETRY) install"
else
	@$(POETRY) install
endif
endif

# existing code...

back:
ifeq ($(DETECTED_OS),Windows)
	@powershell -Command "$(POETRY) run uvicorn lantern.app:app --reload"
else
	@$(POETRY) run uvicorn lantern.app:app --reload
endif

front:
ifeq ($(DETECTED_OS),Windows)
	@powershell -Command "$(POETRY) run python -m http.server 8080"
else
	@$(POETRY) run python -m http.server 8080
endif

# init:
# ifeq ($(POETRY),)
# 	@echo "Poetry not found. Installing..."
# ifeq ($(OS),Linux)
# 	@curl -sSL https://install.python-poetry.org | python3 -
# 	@echo "Poetry installed. Adding Poetry to PATH..."
# 	# On Linux/macOS, add Poetry to PATH for the current session
# 	@echo "$$HOME/.local/bin" >> $(GITHUB_PATH)
# 	@export PATH="$$HOME/.local/bin:$$PATH"
# 	@$$HOME/.local/bin/poetry install
# endif
# ifeq ($(OS),Darwin)
# 	@curl -sSL https://install.python-poetry.org | python3 -
# 	@echo "Poetry installed. Adding Poetry to PATH..."
# 	# On Linux/macOS, add Poetry to PATH for the current session
# 	@echo "$$HOME/.local/bin" >> $(GITHUB_PATH)
# 	@export PATH="$$HOME/.local/bin:$$PATH"
# 	@$$HOME/.local/bin/poetry install
# endif
# ifeq ($(OS),Windows)
# 	# Windows-specific Poetry installation
# 	@powershell -Command "iex (New-Object System.Net.WebClient).DownloadString('https://install.python-poetry.org')"
# 	@echo "Poetry installed. Adding Poetry to PATH..."
# 	# Add Poetry to PATH for Windows (permanent user-level change)
# 	@powershell -Command "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\\Users\\$(USERNAME)\\AppData\\Roaming\\Python\\Scripts', 'User')"
# 	# Run poetry using full path on Windows
# 	@echo "Running Poetry install..."
# 	@powershell -Command "C:\\Users\\$(USERNAME)\\AppData\\Roaming\\Python\\Scripts\\poetry.exe install"
# 	@echo "Poetry installation complete."
# endif
# else
# 	@$(POETRY) install
# endif

format:
	$(POETRY) run black ./lantern/*.py

typecheck:
	$(POETRY) run mypy ./lantern/*.py

run:
	$(POETRY) run python -m lantern.main

load:
	$(POETRY) run python -m lantern.data_loader

# back:
# 	$(POETRY) run uvicorn lantern.app:app --reload
#
# front:
# 	[ -d "./frontend/node_modules" ] || (cd ./frontend && npm install)
# 	cd ./frontend && npm run dev

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

# target to clean up
clean:
	rm -rf __pycache__
	rm -rf .mypy_cache
