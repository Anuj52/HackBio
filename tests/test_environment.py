"""Unit tests for environment.py — grids, diffusion, physics models."""
import numpy as np
import pytest
from environment import Environment


class TestEnvironmentInit:
    def test_grid_dimensions(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        assert env.resource.shape == (10, 10)
        assert env.antibiotic.shape == (10, 10)
        assert env.signal.shape == (10, 10)
        assert env.biofilm.shape == (10, 10)

    def test_initial_resource(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        assert np.allclose(env.resource, 15.0)


class TestDiffusion:
    def test_diffusion_spreads(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        # Create a spike in the center
        env.resource[:] = 0.0
        env.resource[5, 5] = 100.0
        original_center = env.resource[5, 5]
        # Run one step of diffusion
        env._update_resources_cpu()
        # Center should decrease, neighbours should increase
        assert env.resource[5, 5] < original_center
        assert env.resource[5, 4] > 0.0 or env.resource[4, 5] > 0.0


class TestAntibioticInjection:
    def test_gradual_before_start(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        env.step(1)  # Before start_epoch=3
        assert env.antibiotic.max() < 0.01

    def test_gradual_after_start(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        for e in range(1, 6):
            env.step(e)
        # After epoch 3, there should be some antibiotic
        assert env.antibiotic.max() > 0.0

    def test_spike_mode(self, small_cfg):
        cfg = small_cfg.copy()
        cfg["antibiotic"] = small_cfg["antibiotic"].copy()
        cfg["antibiotic"]["mode"] = "spike"
        cfg["antibiotic"]["start_epoch"] = 1
        env = Environment(cfg, force_cpu=True)
        env.step(1)
        # Spike should add uniform concentration
        assert env.antibiotic.mean() > 0.0


class TestResourceConsumption:
    def test_consume_decreases(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        before = env.resource[5, 5]
        env.consume_resource(5, 5, 1.0)
        assert env.resource[5, 5] < before

    def test_consume_clamps_to_zero(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        env.consume_resource(5, 5, 999.0)
        assert env.resource[5, 5] >= 0.0


class TestPhysicsFactors:
    def test_temperature_optimal(self):
        f = Environment.temperature_growth_factor(37.0)
        assert abs(f - 1.0) < 0.05

    def test_temperature_extreme(self):
        f = Environment.temperature_growth_factor(10.0)
        assert f < 0.01

    def test_ph_optimal(self):
        f = Environment.ph_growth_factor(7.0)
        assert abs(f - 1.0) < 0.05

    def test_ph_extreme(self):
        f = Environment.ph_growth_factor(4.0)
        assert f < 0.01

    def test_pressure_normal(self):
        f = Environment.pressure_growth_factor(1.0)
        assert abs(f - 1.0) < 0.01

    def test_pressure_high(self):
        f = Environment.pressure_growth_factor(100.0)
        assert f < 1.0


class TestMeanAccessors:
    def test_mean_resource(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        assert abs(env.mean_resource() - 15.0) < 0.01

    def test_mean_antibiotic_zero(self, small_cfg):
        env = Environment(small_cfg, force_cpu=True)
        assert env.mean_antibiotic() == 0.0
