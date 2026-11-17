"""Public execution stages, with no model reasoning or diagnostic internals."""

LABELS = {
    'understanding': '正在理解需求', 'querying': '正在查询任务与日程',
    'calculating': '正在检查空档并安排时间', 'generating': '正在整理回复',
    'retrying': '连接暂时不稳定，正在重试',
}


def record(run, output, phase=None, *, terminal=None):
    steps = [dict(step) for step in (output.content or {}).get('progress', [])]
    if phase in LABELS:
        run.phase = phase
        if not steps or steps[-1]['phase'] != phase:
            if steps and steps[-1]['status'] == 'running':steps[-1]['status'] = 'done'
            steps.append({'phase':phase, 'label':LABELS[phase], 'status':'running'})
    if terminal and steps:
        steps[-1]['status'] = 'done' if terminal == 'completed' else 'stopped'
    output.content = {**(output.content or {}), 'progress':steps[-24:]}
