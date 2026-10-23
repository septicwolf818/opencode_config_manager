.PHONY: run clean

PYTHON ?= python3
PORT ?= 8000
VENV_PYTHON := .venv/bin/python

run: $(VENV_PYTHON)
	PORT=$(PORT) $(VENV_PYTHON) app/main.py

$(VENV_PYTHON):
	$(PYTHON) -m venv .venv

clean:
	rm -rf .venv __pycache__ app/__pycache__
