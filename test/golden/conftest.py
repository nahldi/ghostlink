from __future__ import annotations


def pytest_addoption(parser):
    parser.addoption("--eval-subset", action="store", default="mandatory")
