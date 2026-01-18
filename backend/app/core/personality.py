def personality_label(score: int) -> str:
    # Score: 0-100
    if score <= 39:
        return "Introvert"
    elif score <= 60:
        return "Omnivert"
    else:
        return "Extrovert"


def personality_multiplier(score: int) -> float:
    """
    Convert 0-100 score to a multiplier.
    Introverts drain more ~1.3
    Extroverts drain less ~0.7
    """
    score = max(0, min(100, int(score)))

    # Linear interpolation from 1.3 (score=0) down to 0.7 (score=100)
    start = 1.3
    end = 0.7
    t = score / 100.0
    return start + (end - start) * t
