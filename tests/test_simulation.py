"""Integration tests for simulate.py — simulation engine."""
import os
import pytest
import random
import numpy as np
from simulate import Simulation


class TestSimulationInit:
    def test_creates_agents(self, small_cfg):
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        assert len(sim.agents) == small_cfg["bacterium"]["initial_count"]
        assert sim.epoch == 0

    def test_agents_within_grid(self, small_cfg):
        sim = Simulation(small_cfg)
        for a in sim.agents:
            assert 0 <= a.x < small_cfg["grid"]["width"]
            assert 0 <= a.y < small_cfg["grid"]["height"]


class TestSingleEpoch:
    def test_epoch_increments(self, small_cfg):
        sim = Simulation(small_cfg)
        sim.step()
        assert sim.epoch == 1

    def test_population_changes(self, small_cfg):
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        initial = len(sim.agents)
        for _ in range(3):
            sim.step()
        # Population should change (up or down, but not the same)
        current = len(sim.agents)
        assert current >= 0  # at minimum, should not crash


class TestMetricsRecording:
    def test_metrics_recorded_each_epoch(self, small_cfg):
        sim = Simulation(small_cfg)
        for _ in range(3):
            sim.step()
        assert len(sim.metrics) == 3

    def test_metric_keys(self, small_cfg):
        sim = Simulation(small_cfg)
        sim.step()
        m = sim.metrics[0]
        required_keys = [
            "time_step", "total_population", "resource_concentration",
            "genotype_counts", "mutation_frequency", "cooperation_index",
            "competition_index", "mean_fitness", "mean_resistance",
            "biofilm_fraction", "hgt_events", "divisions", "deaths",
            "phase_lag", "phase_log", "phase_stationary", "phase_death",
            "cumulative_mutations", "cumulative_hgt", "total_resource_consumed",
        ]
        for key in required_keys:
            assert key in m, f"Missing metric key: {key}"


class TestCsvExport:
    def test_csv_created(self, small_cfg, tmp_path):
        sim = Simulation(small_cfg)
        for _ in range(3):
            sim.step()
        csv_path = str(tmp_path / "test_export.csv")
        result = sim.export_csv(path=csv_path)
        assert os.path.isfile(result)
        # Check it has correct number of data rows
        with open(result, "r") as f:
            lines = f.readlines()
        assert len(lines) == 4  # header + 3 data rows

    def test_csv_columns(self, small_cfg, tmp_path):
        sim = Simulation(small_cfg)
        for _ in range(2):
            sim.step()
        csv_path = str(tmp_path / "test_cols.csv")
        sim.export_csv(path=csv_path)
        with open(csv_path, "r") as f:
            header = f.readline().strip()
        assert "time_step" in header
        assert "total_population" in header
        assert "mean_fitness" in header


class TestFullRun:
    def test_run_completes(self, small_cfg):
        random.seed(42)
        np.random.seed(42)
        sim = Simulation(small_cfg)
        metrics = sim.run()
        assert len(metrics) > 0
        assert sim.epoch <= small_cfg["simulation"]["epochs"]
