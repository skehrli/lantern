import nox
import shutil


@nox.session
def install(session):
    """Ensure Poetry is installed and available in the PATH"""
    poetry_path = shutil.which("poetry")

    if not poetry_path:
        session.log("Poetry not found. Installing...")
        if session.posix:  # Linux/macOS
            session.run("curl", "-sSL", "https://install.python-poetry.org",
                        "|", "python3", external=True)
            poetry_path = f"{session.env['HOME']}/.local/bin/poetry"
        else:  # Windows
            session.run(
                "powershell", "-Command",
                "iex (New-Object System.Net.WebClient).DownloadString('https://install.python-poetry.org')",
                external=True
            )
            poetry_path = f"{session.env['APPDATA']
                             }\\Python\\Scripts\\poetry.exe"

    # Add Poetry to PATH
    session.env["PATH"] += f":{poetry_path.rsplit('/', 1)[0]}"
    session.log(f"Using Poetry at: {poetry_path}")
    session.run("poetry", "install", external=True)


@nox.session
def back(session):
    """Run the backend server using Uvicorn."""
    poetry = "poetry"
    if os.name == "nt":  # Windows
        session.run("powershell", "-Command",
                    f"& '{poetry}' run uvicorn lantern.app:app --reload", external=True)
    else:  # Linux/macOS
        session.run(poetry, "run", "uvicorn", "lantern.app:app",
                    "--reload", external=True)


@nox.session
def front(session):
    """Run the frontend server using Python's HTTP server."""
    poetry = "poetry"
    if os.name == "nt":  # Windows
        session.run("powershell", "-Command",
                    f"& '{poetry}' run python -m http.server 8080", external=True)
    else:  # Linux/macOS
        session.run(poetry, "run", "python", "-m",
                    "http.server", "8080", external=True)
