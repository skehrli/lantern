[![Cross-Platform Tests](https://github.com/skehrli/lantern/actions/workflows/test.yml/badge.svg)](https://github.com/skehrli/lantern/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/skehrli/lantern/branch/master/graph/badge.svg)](https://codecov.io/gh/skehrli/lantern)

Simulation tool for a synthetic Energy Community Dataset.
Can be run inside terminal or as webapp.

# Installation
### Windows
1. Clone Repository.
2. Locate cloned repository in powershell.
3. Run ```.\setup.ps1```. This installs poetry and then all dependencies of the project.
   If you have issues running the script, run ```powershell -ExecutionPolicy Bypass -File .\setup.ps1``` instead.

### Linux/macOS
1. ```git clone https://github.com/skehrli/lantern```
2. ```cd /path/to/lantern```
3. ```bash setup.sh```. Installs poetry if not yet installed and all dependencies using poetry.

# Running Website Locally
1. Open two terminals and locate the lantern directory in each.
2. Run ```poe back``` in first terminal. This runs the backend.
3. Run ```poe front-win``` or ```poe front-unix``` depending on your OS. This runs the frontend.
4. Open your favorite browser at http://localhost:5173
   If something goes wrong, check the logs in the running backend process.
