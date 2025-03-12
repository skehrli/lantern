#!/bin/bash

pip install --user nox || python -m pip install --user nox
nox -s install
