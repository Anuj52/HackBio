"""Tests for dashboard.py — snapshot structure and API endpoints."""
import sys
import os
import json
import random
import pytest
import numpy as np

# Ensure project root is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from flask import Flask
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

from simulate import Simulation


@pytest.mark.skipif(not FLASK_AVAILABLE, reason="flask not installed")
class TestBuildSnapshot:
    def test_snapshot_keys(self, small_cfg):
        from dashboard import build_snapshot
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        sim.step()
        snap = build_snapshot(sim)
        required = [
            "epoch", "total_epochs", "total_population", "grid_w", "grid_h",
            "mean_resource", "mean_antibiotic", "genotype_counts",
            "bacteria", "resource_grid", "antibiotic_grid",
            "ts_epochs", "ts_population", "ts_fitness",
        ]
        for key in required:
            assert key in snap, f"Missing snapshot key: {key}"

    def test_snapshot_serializable(self, small_cfg):
        from dashboard import build_snapshot
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        sim.step()
        snap = build_snapshot(sim)
        json_str = json.dumps(snap)
        assert len(json_str) > 100

    def test_bacteria_list_format(self, small_cfg):
        from dashboard import build_snapshot
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        sim.step()
        snap = build_snapshot(sim)
        if snap["bacteria"]:
            b = snap["bacteria"][0]
            assert isinstance(b, list)
            assert len(b) >= 12


@pytest.mark.skipif(not FLASK_AVAILABLE, reason="flask not installed")
class TestFlaskApp:
    @pytest.fixture
    def client(self):
        from dashboard import app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_index_route(self, client):
        rv = client.get("/")
        assert rv.status_code == 200

    def test_snapshot_no_data(self, client):
        rv = client.get("/api/snapshot")
        assert rv.status_code in (200, 204)
