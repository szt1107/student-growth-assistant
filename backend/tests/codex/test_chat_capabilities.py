"""Chat-first calendar capabilities; isolated DBs and mocked model decisions."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from app.services import ai_skills, conversation_tools, claude_client
from app.services.conversation_tools import plan as real_plan
from app.workspace_schemas import ToolCall, ToolPlan


@pytest.mark.parametrize('text,operation', [
    ('今天先做什么比较好？', 'query'),
    ('我现在应该先做哪件事', 'query'),
    ('事情太多了，帮我排个优先级', 'query'),
    ('这周有哪些空档', 'query'),
    ('课程汇报不知道从哪开始，帮我分几步', 'task'),
    ('帮我把论文分解成小任务', 'task'),
    ('每周二14点到16点有操作系统课，帮我记到课表里', 'profile'),
    ('每天12点到13点是午休，留出来别排任务', 'profile'),
    ('午休别排任务', 'profile'),
    ('每周三下午两点到四点有课', 'profile'),
    ('每周二14点到16点有操作系统课', 'profile'),
    ('把午休时间改成12点到13点', 'profile'),
    ('停用周二的课程规则', 'profile'),
    ('操作系统作业做完了，花了60分钟', 'feedback'),
    ('论文今天只做了一半，还剩90分钟', 'feedback'),
    ('今天没做英语，先推迟，帮我记一下', 'feedback'),
    ('开始给论文计时', 'feedback'),
    ('暂停论文计时', 'feedback'),
    ('结束计时', 'feedback'),
    ('继续刚才的计时', 'feedback'),
    ('明天晚上帮我腾出一小时写报告', 'schedule'),
    ('帮我制定明天的学习计划', 'schedule'),
    ('查看我的课表', 'query'),
])
def test_natural_language_capabilities(text, operation):
    assert ai_skills.select_skills(text).operation == operation


@pytest.mark.parametrize('text', [
    '先不要把周二的课加入课表', '如果每周三下午有课会怎样',
    '他说“作业做完了花了60分钟”是什么意思', '不要记录任务完成',
    '什么叫保护时间', '如果我说论文做完了你会怎么处理',
    '暂停计时是什么意思', '先别暂停计时',
    '午休留出来别排任务，但先不要生成草案',
])
def test_discussion_and_negation_never_grant_writes(text):
    assert ai_skills.select_skills(text).expected is None


def test_read_tools_and_schema_reach_the_real_planner(monkeypatch):
    packets = []
    async def provider(text, system, config, *args, **kwargs):
        packets.append((json.loads(text), system))
        return json.dumps({'calls': [{'name': 'attention'}]})
    monkeypatch.setattr(claude_client, 'get_claude_config', lambda: None)
    monkeypatch.setattr(claude_client, 'request_claude', provider)
    result = asyncio.run(real_plan({'message': '今天先做什么比较好？', 'history': [], 'context': {}}))
    assert result.calls[0].name == 'attention'
    packet, system = packets[0]
    assert {'attention', 'time_rules', 'task_execution'} <= set(packet['allowed_tools'])
    assert 'attention' in packet['tool_schemas']
    assert '优先' in system
    ToolPlan(calls=[{'name': 'attention'}], continue_after_read=True)


def test_rule_contract_reaches_profile_planner(monkeypatch):
    packets = []
    async def provider(text, *args, **kwargs):
        packets.append(json.loads(text))
        return '{"calls":[]}'
    monkeypatch.setattr(claude_client, 'get_claude_config', lambda: None)
    monkeypatch.setattr(claude_client, 'request_claude', provider)
    asyncio.run(real_plan({'message': '每周三下午两点到四点有课', 'history': [], 'context': {}}))
    assert 'create_time_rule' in packets[0]['business_operations']
    assert 'time_rule_schema' in packets[0]


def run_tool(client, test_engine, name, arguments=None):
    from sqlalchemy.orm import Session
    from fastapi.encoders import jsonable_encoder
    with Session(test_engine) as db:
        return jsonable_encoder(asyncio.run(conversation_tools.execute(db, SimpleNamespace(id=100, text='', payload={}), ToolCall(name=name, arguments=arguments or {}), 0)))


def draft(client, test_engine, kind, operations, key='one'):
    from sqlalchemy.orm import Session
    from app.models import AssistantRun
    sid = client.post('/api/conversations', json={'client_request_id': key}).json()['id']
    with Session(test_engine) as db:
        from app.services.workspace_views import revision
        run = AssistantRun(session_id=sid, client_message_id=key, source_revision=revision(db), text='用户请求的修改', status='completed', phase='finished', payload={})
        db.add(run); db.commit(); db.refresh(run)
        result = asyncio.run(conversation_tools.execute(db, run, ToolCall(name=kind+'_draft', arguments={'operations': operations}), 0))
    response = client.get(f"/api/workspace/drafts/{kind}/{result['draft']['id']}")
    assert response.status_code == 200, response.text
    return response.json()


def confirm(client, value):
    return client.post(f"/api/workspace/drafts/{value['kind']}/{value['id']}/confirm", json={'expected_version': value['version']})


def test_course_and_protected_rules_wait_for_confirmation_and_are_idempotent(client, test_engine):
    values = {'kind': 'course', 'title': '操作系统课', 'recurrence': 'weekly', 'weekday': 2, 'start_time': '14:00', 'end_time': '16:00'}
    value = draft(client, test_engine, 'profile', [{'op': 'create_time_rule', **values}])
    assert client.get('/api/time-rules').json() == []
    assert confirm(client, value).status_code == 200
    assert confirm(client, value).status_code == 200
    rules = client.get('/api/time-rules').json()
    assert len(rules) == 1 and rules[0]['title'] == '操作系统课'
    read = run_tool(client, test_engine, 'time_rules')
    assert read['items'][0]['id'] == rules[0]['id']
    update = draft(client, test_engine, 'profile', [{'op': 'update_time_rule', 'id': rules[0]['id'], 'fields': {'active': False}}], 'update')
    assert confirm(client, update).status_code == 200
    assert not client.get('/api/time-rules').json()[0]['active']
    protected = draft(client, test_engine, 'profile', [{'op': 'create_time_rule', **{**values, 'kind': 'protected', 'title': '午休', 'start_time': '12:00', 'end_time': '13:00'}}], 'protected')
    assert confirm(client, protected).status_code == 200
    assert client.get('/api/time-rules').json()[1]['kind'] == 'protected'


def test_stale_course_draft_cannot_change_newer_rules(client, test_engine):
    op = {'op': 'create_time_rule', 'kind': 'protected', 'title': '午休', 'recurrence': 'weekly', 'weekday': 3, 'start_time': '12:00', 'end_time': '13:00'}
    value = draft(client, test_engine, 'profile', [op])
    assert client.post('/api/time-rules', json={k:v for k,v in op.items() if k!='op'}).status_code == 201
    assert confirm(client, value).status_code == 409
    assert len(client.get('/api/time-rules').json()) == 1


def test_attention_is_real_readonly_and_execution_returns_feedback(client, test_engine):
    task = client.post('/api/tasks', json={'title': '软件工程报告', 'duration_minutes': 60, 'deadline': '2026-10-15T21:00:00+08:00'}).json()
    read = run_tool(client, test_engine, 'attention')
    assert read['items'][0]['task_id'] == task['id']
    value = draft(client, test_engine, 'feedback', [{'op': 'record_feedback', 'task_id': task['id'], 'outcome': 'completed', 'actual_minutes': 75}])
    assert client.get('/api/tasks').json()[0]['status'] == 'todo'
    assert confirm(client, value).status_code == 200
    read = run_tool(client, test_engine, 'task_execution', {'id': task['id']})
    assert read['task']['status'] == 'done'
    assert read['feedback']['entries'][0]['actual_minutes'] == 75


def test_timer_chat_draft_runs_only_after_confirm_and_stop_does_not_complete(client, test_engine):
    task = client.post('/api/tasks', json={'title': '论文', 'duration_minutes': 60, 'deadline': '2026-10-16T21:00:00+08:00'}).json()
    value = draft(client, test_engine, 'feedback', [{'op': 'work_timer', 'task_id': task['id'], 'action': 'start'}])
    assert client.get(f"/api/tasks/{task['id']}/work-sessions/current").json()['session'] is None
    assert confirm(client, value).status_code == 200
    assert confirm(client, value).status_code == 200
    session = client.get(f"/api/tasks/{task['id']}/work-sessions/current").json()['session']
    assert run_tool(client,test_engine,'task_execution')['active_timers'][0]['task_id']==task['id']
    for action in ('pause', 'resume', 'finish'):
        value = draft(client, test_engine, 'feedback', [{'op': 'work_timer', 'task_id': task['id'], 'action': action, 'session_id': session['id'], 'expected_updated_at': session['updated_at']}], action)
        assert confirm(client, value).status_code == 200
        read = run_tool(client, test_engine, 'task_execution', {'id': task['id']})
        session = read['timer']
    assert session['status'] == 'stopped'
    assert client.get('/api/tasks').json()[0]['status'] == 'todo'


@pytest.mark.parametrize('message,tool,arguments', [
    ('今天先做什么比较好？', 'attention', {}),
    ('查看我的课表', 'time_rules', {}),
    ('每周二下午两点到四点有课', 'profile_draft', {'operations':[{'op':'create_time_rule','title':'课程','kind':'course','recurrence':'weekly','weekday':2,'start_time':'14:00','end_time':'16:00'}]}),
    ('软件工程报告做完了花了60分钟', 'feedback_draft', {'operations':[{'op':'record_feedback','task_id':1,'outcome':'completed','actual_minutes':60}]}),
])
def test_full_chat_pipeline_uses_real_planner_and_tools(client, monkeypatch, message, tool, arguments):
    import time
    from app.services import conversation_runs
    client.post('/api/tasks',json={'title':'软件工程报告','duration_minutes':60,'deadline':'2026-10-15T21:00:00+08:00'})
    sid=client.post('/api/conversations',json={'client_request_id':'full-flow'}).json()['id']
    packets=[]
    async def provider(text,*args,**kwargs):
        packet=json.loads(text);packets.append(packet)
        return json.dumps({'calls':[{'name':tool,'arguments':arguments}]})
    async def reply(request):
        yield {'type':'delta','text':'已读取真实工具结果。'}
    monkeypatch.setattr(claude_client,'get_claude_config',lambda:None)
    monkeypatch.setattr(claude_client,'request_claude',provider)
    monkeypatch.setattr(conversation_tools,'plan',real_plan)
    monkeypatch.setattr(conversation_runs,'reply_events',reply)
    initial=client.post(f'/api/conversations/{sid}/runs',json={'client_message_id':'run','text':message})
    assert initial.status_code in (200,202),initial.text
    for _ in range(150):
        result=client.get(f"/api/conversations/{sid}/runs/{initial.json()['id']}").json()
        if result['status']!='running':break
        time.sleep(.02)
    assert result['status']=='completed',result
    assert tool in packets[0]['allowed_tools']
    assert result['content']['tools'][0]['tool']==tool
    assert not result['content']['tools'][0].get('error'),result
    assert client.get('/api/time-rules').json()==[]
    assert client.get('/api/tasks').json()[0]['status']=='todo'


def test_quoted_and_wrong_scope_tools_are_denied():
    selection=ai_skills.select_skills('看看今天任务，不要记录完成')
    assert ai_skills.validate_plan(ToolPlan(calls=[{'name':'feedback_draft','arguments':{'operations':[]}}]),selection)=='TOOL_NOT_ALLOWED'


def test_partial_time_followup_keeps_profile_intent():
    history=[{'role':'user','text':'每周三有课，帮我加入课表'}, {'role':'assistant','text':'几点到几点？','business_status':'needs_input'}]
    assert ai_skills.select_skills('改成14点到16点',history).expected=='profile'


def test_completed_task_timer_can_finish_and_release_global_timer(client,test_engine):
    first=client.post('/api/tasks',json={'title':'报告A','duration_minutes':60,'deadline':'2026-10-16T21:00:00+08:00'}).json()
    second=client.post('/api/tasks',json={'title':'报告B','duration_minutes':60,'deadline':'2026-10-16T21:00:00+08:00'}).json()
    start=draft(client,test_engine,'feedback',[{'op':'work_timer','task_id':first['id'],'action':'start'}],'start-a')
    assert confirm(client,start).status_code==200
    completed=draft(client,test_engine,'feedback',[{'op':'record_feedback','task_id':first['id'],'outcome':'completed','actual_minutes':60}],'complete-a')
    assert confirm(client,completed).status_code==200
    timer=run_tool(client,test_engine,'task_execution',{'id':first['id']})['timer']
    finish=draft(client,test_engine,'feedback',[{'op':'work_timer','task_id':first['id'],'action':'finish','session_id':timer['id'],'expected_updated_at':timer['updated_at']}],'finish-a')
    assert confirm(client,finish).status_code==200
    start=draft(client,test_engine,'feedback',[{'op':'work_timer','task_id':second['id'],'action':'start'}],'start-b')
    assert confirm(client,start).status_code==200
