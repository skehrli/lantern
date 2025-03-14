from lantern.main import run_simulation
from lantern.main import Season
import random
import pytest


@pytest.mark.parametrize('iteration', range(10))
def test_simulation(iteration):
    random.seed(42)
    community_size: int = random.randint(5, 100)
    season: Season = random.choice(list(Season))
    pv: int = random.randint(0, 100)
    sd: int = random.randint(0, 100)
    battery: bool = random.choice([True, False])
    run_simulation(community_size, season.value, pv, sd, battery)
