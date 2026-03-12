"""Shared fixtures for all tests."""
import sys
import os
import pytest
import yaml

# Ensure project root is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def small_cfg():
    """Minimal config for fast tests (10x10 grid, 10 bacteria, 5 epochs)."""
    return {
        "grid": {"width": 10, "height": 10, "z_levels": 3},
        "resource": {
            "scenario": "resource-rich",
            "initial_concentration": 15.0,
            "replenishment_rate": 0.25,
            "diffusion_rate": 0.1,
            "max_concentration": 30.0,
        },
        "antibiotic": {
            "mode": "gradual",
            "start_epoch": 3,
            "gradual_rate": 0.05,
            "spike_concentration": 5.0,
            "decay_rate": 0.015,
            "diffusion_rate": 0.3,
            "max_concentration": 8.0,
        },
        "bacterium": {
            "initial_count": 10,
            "max_age": 300,
            "division_threshold": 2.0,
            "base_death_rate": 0.005,
            "lag_phase_duration": 2,
            "maintenance_energy": 0.01,
            "toxin_production_cost": 0.02,
            "public_good_cost": 0.015,
        },
        "monod": {"mu_max": 0.8, "Ks": 1.0, "yield_coefficient": 0.4},
        "mutation": {
            "rate": 0.01,
            "resistance_delta": 0.1,
            "efficiency_delta": 0.05,
            "toxin_production_delta": 0.03,
            "public_good_delta": 0.03,
        },
        "genotype": {"initial_types": 2, "max_types": 5},
        "quorum_sensing": {
            "signal_production_rate": 0.05,
            "signal_diffusion_rate": 0.12,
            "signal_decay_rate": 0.05,
            "activation_threshold": 0.15,
            "biofilm_resistance_multiplier": 0.5,
            "biofilm_resource_sharing": 0.05,
        },
        "toxin": {
            "secretion_rate": 0.12,
            "diffusion_rate": 0.04,
            "decay_rate": 0.03,
            "lethality": 0.15,
            "self_immunity": 1.0,
        },
        "hgt": {"probability": 0.005, "radius": 1},
        "population": {"carrying_capacity": 100},
        "fitness": {
            "weight_growth": 0.4,
            "weight_resistance": 0.3,
            "weight_efficiency": 0.2,
            "weight_cooperation": 0.1,
        },
        "physics": {"temperature": 37.0, "pressure_atm": 1.0, "ph": 7.0},
        "rl": {"enabled": False, "force_cpu": True, "gamma": 0.99,
               "epsilon_start": 1.0, "epsilon_min": 0.05, "epsilon_decay": 0.995,
               "batch_size": 32, "buffer_size": 1000, "learning_rate": 0.001,
               "target_update_freq": 10, "tau": 0.005, "train_every": 5},
        "simulation": {
            "epochs": 5,
            "output_dir": "output",
            "charts_dir": "charts",
            "csv_filename": "test_metrics.csv",
            "seed": 42,
        },
    }


@pytest.fixture
def full_cfg():
    """Load the real config.yaml if available, else fall back to small_cfg."""
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
    if os.path.exists(cfg_path):
        with open(cfg_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    return small_cfg()
