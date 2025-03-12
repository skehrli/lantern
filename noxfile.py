import os
import shutil
import sys
import nox


@nox.session
def install(session):
    """Ensure Poetry is installed and available in the PATH"""
    poetry_path = shutil.which("poetry")

    if not poetry_path:
        session.log("Poetry not found. Installing...")
        if sys.platform in ["linux", "darwin"]:  # Linux/macOS
            session.run("curl", "-sSL", "https://install.python-poetry.org",
                        "|", "python3", external=True)
            poetry_path = f"{session.env['HOME']}/.local/bin/poetry"
        else:  # Windows
            # Use an alternative method to install Poetry for Windows
            session.run(
                "powershell", "-Command",
                "Invoke-WebRequest -Uri 'https://install.python-poetry.org' -OutFile 'install-poetry.ps1'; "
                "powershell -ExecutionPolicy Bypass -File './install-poetry.ps1'",
                external=True
            )
            poetry_path = f"{session.env['APPDATA']
                             }\\Python\\Scripts\\poetry.exe"

    # Initialize PATH if it's not already in the session.env
    if "PATH" not in session.env:
        session.env["PATH"] = os.environ.get("PATH", "")

    # Add Poetry to PATH
    session.env["PATH"] += os.pathsep + os.path.dirname(poetry_path)
    session.log(f"Using Poetry at: {poetry_path}")

    # Run poetry install inside the virtual environment
    session.run("poetry", "install", external=True)


@nox.session
def back(session):
    """Run the backend server using Uvicorn."""
    poetry = "poetry"
    if sys.platform == "win32":  # Windows
        # Run the server inside the virtual environment with Poetry
        session.run("powershell", "-Command",
                    f"& '{poetry}' run uvicorn lantern.app:app --reload", external=True)
    else:  # Linux/macOS
        # Ensure that uvicorn is installed and run the server inside the virtual environment
        session.run(poetry, "run", "uvicorn", "lantern.app:app",
                    "--reload", external=True)


@nox.session
def front(session):
    """Run the frontend server using Python's HTTP server."""
    poetry = "poetry"
    if sys.platform == "win32":  # Windows
        session.run("powershell", "-Command",
                    f"& '{poetry}' run python -m http.server 8080", external=True)
    else:  # Linux/macOS
        session.run(poetry, "run", "python", "-m",
                    "http.server", "8080", external=True)
