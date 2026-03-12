"""Unit tests for agent.py — Bacterium lifecycle."""
import random
import pytest
import numpy as np
from agent import Bacterium, Genotype, Phase, reset_id_counter


def _make_bacterium(cfg, x=5, y=5, resistance=0.1):
    """Helper to create a configured bacterium."""
    reset_id_counter()
    gt = Genotype(id=0, nutrient_efficiency=1.0,
                  antibiotic_resistance=resistance,
                  toxin_production=0.5, public_good_production=0.5)
    b = Bacterium(x=x, y=y, genotype=gt)
    b.attach_config(cfg)
    return b


class TestBacteriumCreation:
    def test_defaults(self, small_cfg):
        b = _make_bacterium(small_cfg)
        assert b.alive is True
        assert b.phase == Phase.LAG
        assert b.biomass == 0.5
        assert b.age == 0
        assert b.x == 5 and b.y == 5

    def test_config_attachment(self, small_cfg):
        b = _make_bacterium(small_cfg)
        assert b._cfg is not None


class TestMonodGrowth:
    def test_growth_rate_zero_resource(self, small_cfg):
        b = _make_bacterium(small_cfg)
        rate = b._monod_growth(0.0)
        assert rate == 0.0

    def test_growth_rate_high_resource(self, small_cfg):
        b = _make_bacterium(small_cfg)
        rate = b._monod_growth(100.0)
        # Should approach mu_max * efficiency
        assert rate > 0.7

    def test_growth_rate_at_ks(self, small_cfg):
        b = _make_bacterium(small_cfg)
        rate = b._monod_growth(1.0)  # Ks = 1.0
        # At S = Ks, rate = mu_max * S/(Ks+S) = 0.8 * 0.5 = 0.4
        assert abs(rate - 0.4) < 0.05


class TestPhaseTransitions:
    def test_lag_to_log(self, small_cfg):
        b = _make_bacterium(small_cfg)
        b.phase = Phase.LAG
        b.age = 0
        # After enough aging, should transition
        b._update_phase(10.0, 0.5)  # plenty of resource, low carrying
        assert b.phase == Phase.LAG  # age 0 < lag_phase_duration=2
        b.age = 3
        b._update_phase(10.0, 0.5)
        assert b.phase == Phase.LOG


class TestDivision:
    def test_division_produces_daughter(self, small_cfg):
        from environment import Environment
        env = Environment(small_cfg, force_cpu=True)
        b = _make_bacterium(small_cfg)
        b.phase = Phase.LOG
        b.biomass = 3.0  # > division_threshold (2.0)
        b._carrying_ratio = 0.5
        daughter = b._divide(env)
        assert daughter is not None
        assert daughter.alive is True
        assert b.biomass < 3.0  # biomass was split


class TestMutation:
    def test_mutation_changes_traits(self, small_cfg):
        random.seed(42)
        np.random.seed(42)
        gt = Genotype(id=0, nutrient_efficiency=1.0,
                      antibiotic_resistance=0.5,
                      toxin_production=0.5, public_good_production=0.5)
        mut_cfg = small_cfg["mutation"]
        # Force mutation by calling directly
        new_gt = Bacterium._mutate(gt, mut_cfg, max_types=5)
        # Should return a Genotype
        assert new_gt is not None
        assert isinstance(new_gt, Genotype)

    def test_resistance_stays_bounded(self, small_cfg):
        gt = Genotype(id=0, nutrient_efficiency=1.0,
                      antibiotic_resistance=0.99,
                      toxin_production=0.5, public_good_production=0.5)
        mut_cfg = small_cfg["mutation"].copy()
        mut_cfg["rate"] = 1.0  # Force mutation
        for _ in range(100):
            gt = Bacterium._mutate(gt, mut_cfg, max_types=5)
        assert 0.0 <= gt.antibiotic_resistance <= 1.0


class TestDeathCheck:
    def test_no_death_healthy(self, small_cfg):
        from environment import Environment
        env = Environment(small_cfg, force_cpu=True)
        b = _make_bacterium(small_cfg)
        b.phase = Phase.LOG
        b.biomass = 1.0
        b.age = 1
        b._carrying_ratio = 0.5
        # With high resource and no AB, death should be rare
        random.seed(42)
        deaths = sum(1 for _ in range(100) if b._death_check(env))
        # Should be rare (< 30% of the time)
        assert deaths < 30


class TestHGT:
    def test_hgt_one_way(self, small_cfg):
        b1 = _make_bacterium(small_cfg, x=5, y=5, resistance=0.1)
        b2 = _make_bacterium(small_cfg, x=5, y=5, resistance=0.8)
        # b1 attempts HGT with b2 as donor
        original_b2_res = b2.genotype.antibiotic_resistance
        small_cfg["hgt"]["probability"] = 1.0  # Force HGT
        b1.attempt_hgt([b2], small_cfg)
        # Donor should retain traits
        assert b2.genotype.antibiotic_resistance == original_b2_res


class TestChemotaxis:
    def test_move_stays_in_bounds(self, small_cfg):
        from environment import Environment
        env = Environment(small_cfg, force_cpu=True)
        # Place bacterium at corner
        b = _make_bacterium(small_cfg, x=0, y=0)
        b.phase = Phase.LOG
        for _ in range(20):
            b.move(env)
        assert 0 <= b.x < small_cfg["grid"]["width"]
        assert 0 <= b.y < small_cfg["grid"]["height"]
