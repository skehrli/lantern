#!/bin/bash

# Exit immediately if a command fails
set -e

if ! command -v pipx &> /dev/null; then
    echo "pipx not found. Installing..."
    python -m pip install --user pipx
    python -m pipx ensurepath
    export PATH="$HOME/.local/bin:$PATH"
fi

# Add pipx's install location to PATH for the current session
export PATH="$HOME/.local/bin:$PATH"

echo "Installing Poetry..."
pipx install poetry

echo "Installing Poethepoet..."
pipx install poethepoet

# Verify installations
echo "Verifying installations..."
if command -v poetry &> /dev/null && command -v poe &> /dev/null; then
    echo "Installation successful!"
    echo "Poetry version: $(poetry --version)"
    echo "Poe the Poet version: $(poe --version)"
    poetry install
else
    echo "Installation completed, but PATH may not be updated correctly. Try running:"
    echo "export PATH=\$HOME/.local/bin:\$PATH"
fi

