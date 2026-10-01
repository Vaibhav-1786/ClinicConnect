"""Small geo utilities shared by the matching engine and map endpoints."""
import math


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in kilometers between two lat/lon points."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    lat1, lon1, lat2, lon2 = map(float, (lat1, lon1, lat2, lon2))
    r = 6371.0088
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return r * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def distance_score(distance_km, max_km=25.0):
    """0-100 score: 100 at 0km, linearly decaying to 0 at max_km and beyond."""
    if distance_km is None:
        return 50.0  # neutral score when either point lacks coordinates
    if distance_km <= 0:
        return 100.0
    if distance_km >= max_km:
        return 0.0
    return round(100.0 * (1 - distance_km / max_km), 2)
