DAY_MINUTES = 24 * 60


def valid_task_interval(start, end):
    """All 24 hours are available, including intervals across midnight."""
    minutes = (end - start).total_seconds() / 60
    return (0 < minutes <= DAY_MINUTES and minutes % GRID_MINUTES == 0
        and all(value.minute % GRID_MINUTES == 0 and not value.second and not value.microsecond
            for value in (start, end)))


GRID_MINUTES = 5
WINDOW_DAYS = 14
