import nox
import shutil
import os
import sys


@nox.session
def install(session):
    """Ensure Poetry is installed and available in the PATH."""
    poetry_path = shutil.which("poetry")

    if not poetry_path:
        session.log("Poetry not found. Installing...")

        if sys.platform in ["linux", "darwin"]:  # Linux/macOS
            session.run("curl", "-sSL", "https://install.python-poetry.org",
                        "-o", "install-poetry.py", external=True)
            session.run("python3", "install-poetry.py", external=True)
            os.remove("install-poetry.py")  # Cleanup
            poetry_path = os.path.expanduser("~/.local/bin/poetry")

        elif sys.platform == "win32":  # Windows
            session.run(
                "powershell", "-Command",
                "iex (New-Object System.Net.WebClient).DownloadString('https://install.python-poetry.org')",
                external=True
            )
            poetry_path = os.path.join(
                os.getenv("APPDATA"), "Python", "Scripts", "poetry.exe")

    # Add Poetry to PATH
    poetry_bin = os.path.dirname(poetry_path)
    session.env["PATH"] += os.pathsep + poetry_bin
    session.log(f"Using Poetry at: {poetry_path}")

    # Install dependencies
    session.run("poetry", "install", external=True)


@nox.session
def back(session):
    """Run the backend server using Uvicorn."""
    poetry = "poetry"
    if sys.platform == "win32":  # Windows
        session.run("powershell", "-Command",
                    f"& '{poetry}' run uvicorn lantern.app:app --reload", external=True)
    else:  # Linux/macOS
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
