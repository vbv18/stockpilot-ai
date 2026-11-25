from __future__ import annotations

from typing import Literal
import numpy as np

ADI_CUTOFF = 1.32
CV2_CUTOFF = 0.49

DemandClass = Literal["smooth", "erratic", "intermittent"]


def classify_demand(y: np.ndarray) -> tuple[DemandClass, float, float]:
    """
    Computes Average Demand Interval (ADI) and squared Coefficient of Variation (CV^2)
    of non-zero demand sizes according to the Syntetos-Boylan (2005) categorisation:
      - ADI cutoff = 1.32
      - CV^2 cutoff = 0.49

    Categories:
      - ADI < 1.32, CV^2 < 0.49  => smooth
      - ADI < 1.32, CV^2 >= 0.49 => erratic
      - ADI >= 1.32              => intermittent
    """
    y_arr = np.asarray(y, dtype=float)
    n = len(y_arr)
    if n == 0:
        return "smooth", 1.0, 0.0

    nonzero = y_arr[y_arr > 0]
    k = len(nonzero)

    if k == 0:
        adi = float(n)
        cv2 = 0.0
    else:
        adi = float(n / k)
        mean_size = float(np.mean(nonzero))
        if k > 1 and mean_size > 0:
            std_size = float(np.std(nonzero, ddof=1))
            cv2 = float((std_size / mean_size) ** 2)
        else:
            cv2 = 0.0

    if adi < ADI_CUTOFF:
        demand_class: DemandClass = "smooth" if cv2 < CV2_CUTOFF else "erratic"
    else:
        demand_class = "intermittent"

    return demand_class, round(adi, 4), round(cv2, 4)
