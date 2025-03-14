# Stop execution on any error
$ErrorActionPreference = "Stop"

if (-not (Get-Command pipx -ErrorAction SilentlyContinue)) {
    Write-Host "pipx not found. Installing..."
    python -m pip install --user pipx
    python -m pipx ensurepath
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

# Add pipx install location to PATH for the current session (Windows)
$PipxPath = "$env:USERPROFILE\.local\bin"
$PoetryPath = "$env:APPDATA\Python\Scripts"

if (-Not ($env:Path -like "*$PipxPath*")) {
    $env:Path = "$PipxPath;$env:Path"
}

if (-Not ($env:Path -like "*$PoetryPath*")) {
    $env:Path = "$PoetryPath;$env:Path"
}

Write-Host "Installing Poetry..."
pipx install poetry

Write-Host "Installing Poethepoet..."
pipx install poethepoet

# Verify installations
Write-Host "Verifying installations..."
if ((Get-Command poetry -ErrorAction SilentlyContinue) -and (Get-Command poe -ErrorAction SilentlyContinue)) {
    Write-Host "Installation successful!"
    Write-Host "Poetry version: $(poetry --version)"
    Write-Host "Poe the Poet version: $(poe --version)"

    # Install project dependencies if pyproject.toml exists
    if (Test-Path "pyproject.toml") {
        Write-Host "Installing project dependencies with Poetry..."
        poetry install
    }
} else {
    Write-Host "Installation completed, but PATH may not be updated correctly."
    Write-Host "You may need to manually run:"
    Write-Host "`$env:Path = '$PipxPath;$PoetryPath;$env:Path'"
}
