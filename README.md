[![Cross-Platform Tests](https://github.com/skehrli/lantern/actions/workflows/test.yml/badge.svg)](https://github.com/skehrli/lantern/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/skehrli/lantern/branch/master/graph/badge.svg?token=Q55PSAK5N5)](https://codecov.io/gh/skehrli/lantern)

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

# Supplying your own dataset
The simulation by default runs on household data from a municipality in Switzerland. You can provide your own data
by replacing the `.pkl` files in the /dataframes directory.
You can compress a dataframe `df` into the `.pkl` binary format with `df.to_pickle("file.pkl")`.
Make sure that the names of the files are `load.pkl` and `pv.pkl` for the load and generation data respectively.

The columns of the dataframes must be timestamps and the rows are the measurements for each household respectively in kWh.
Make sure your dataframe looks something like this:

`
timestamp  2024-01-01 00:00:00+01:00  ...  2024-12-31 22:00:00+01:00
id                                    ...
1                              2.080  ...                      0.067
2                              0.270  ...                      0.268
5                              0.051  ...                      0.196
6                              0.242  ...                      0.304
15                             0.026  ...                      0.043
...                              ...  ...                        ...
1464                           0.040  ...                      0.027
1466                           0.303  ...                      0.172
1468                           0.463  ...                      0.301
1476                           0.060  ...                      0.145
1478                           0.247  ...                      0.300
`

The timeframe is not important (although at most a calendar year), but the measurements should be hourly. If your dataset has more frequent measurements,
sum them to hourly timestamps, and if they're less frequent, interpolate the missing ones.

The simulation then aggregates six households each into residential buildings. Thus, your dataset should contain at least
600 rows (i.e. 600 households). You can also just replace the `load.pkl` file and keep the synthetic PV data.

If you have actual PV generation data, you should always set the PV adoption parameter in the frontend to 100%. The way
it works is that it simply sets the ones that (it randomly decides) don't have PV to zero, which you likely don't want.

# Information about simulation
The simulation proceeds in hourly timesteps:
1. PV generation is used for self-consumption first.
2. If more produced energy remains, it is put into the per-building battery if one exists.
   If not, the per-building battery is discharged if possible.
3. If more produced energy remains, it is offered on the local energy market.
   If not, the missing energy is requested on the local energy market.
   A market clearing algorithm matches offers/requests optimally. The price is the average between grid feed-in and grid purchase prices.
4. If (some) energy offered on the market remains unsold, it is fed into the grid.
   If (some) energy requested on the market remains unsatisifed, it is purchased from the grid.
