"""Bounded deterministic replanning. No database or model access."""
from copy import deepcopy
from functools import lru_cache
from time import monotonic
from datetime import datetime, date, time, timedelta
from math import ceil, isfinite
import os
from .scheduling_types import SHANGHAI
from .planning_window import GRID_MINUTES, WINDOW_DAYS, expand_window_rules
from .grid import DAY_MINUTES, valid_task_interval

WEIGHTS = {'high':9,'normal':3,'low':1}
GOAL_WEIGHTS = {1:3, 2:2, 3:1}
STRATEGY_WEIGHTS = {'balanced':(4,3,3), 'preference':(6,2,2), 'stable':(2,6,2)}
SPLIT_FRAGMENT_WEIGHT = .02
SEARCH_SECONDS = 20
SEARCH_EXPANSIONS = 50000


def _soft_config():
    """Request-local configuration. Zero weights recover the original ranking."""
    settings = {}
    for key, variable, default, upper in (
        ('daily_load_weight', 'SGA_DAILY_LOAD_WEIGHT', .15, 1),
        ('rest_weight', 'SGA_REST_WEIGHT', .10, 1),
        ('continuous_minutes', 'SGA_CONTINUOUS_WORK_MINUTES', 90, 840),
        ('break_minutes', 'SGA_MIN_BREAK_MINUTES', 15, 120),
    ):
        try:
            value = float(os.getenv(variable, default))
        except ValueError:
            value = default
        minimum = 0 if key.endswith('weight') else GRID_MINUTES
        settings[key] = value if isfinite(value) and minimum <= value <= upper else default
    return settings


def _study_spans(spans):
    """Union overlapping facts, retaining adjacent session boundaries."""
    result = []
    for start, end in sorted(set(spans)):
        if result and start < result[-1][1]:
            result[-1] = (result[-1][0], max(end, result[-1][1]))
        else:
            result.append((start, end))
    return result


def _rest_cost(spans, settings):
    cost = work = 0
    previous_end = previous_minutes = None
    for start, end in spans:
        minutes = end - start
        gap = start - previous_end if previous_end is not None else settings['break_minutes']
        if gap >= settings['break_minutes']:
            cost += max(0, work - settings['continuous_minutes']) ** 2
            work = 0
        else:
            cost += (settings['break_minutes'] - gap) * min(previous_minutes, minutes)
        work += minutes
        previous_end, previous_minutes = end, minutes
    return cost + max(0, work - settings['continuous_minutes']) ** 2


def _workload_context(week, tasks, previous, rule_intervals):
    settings = _soft_config()
    if not (settings['daily_load_weight'] or settings['rest_weight']):
        return None
    selected = {task['ref'] for task in tasks}
    frozen = {task['ref'] for task in tasks if (task.get('profile') or {}).get('locked')}
    spans = [(rule.start_at, rule.end_at) for rule in rule_intervals if rule.kind == 'course']
    spans.extend(interval(item) for item in previous if item['ref'] not in selected or item['ref'] in frozen)
    days = [[] for _ in range(WINDOW_DAYS)]
    for start, end in spans:
        # Clip across dates, including elapsed study on the current day.
        for day in range(max(0, (start.date() - week).days), min(WINDOW_DAYS, (end.date() - week).days + 1)):
            midnight = datetime.combine(week + timedelta(days=day), time.min, SHANGHAI)
            left = max(0, (start - midnight).total_seconds() / 60)
            right = min(1440, (end - midnight).total_seconds() / 60)
            if left < right:
                days[day].append((left, right))
    days = [tuple(_study_spans(day)) for day in days]
    return dict(settings=settings, days=days,
                loads=[sum(end-start for start, end in day) for day in days],
                rest=[_rest_cost(day, settings) for day in days], cost_cache={})


def _workload_penalty(items, week, context):
    if context is None:
        return 0
    additions = {}
    minutes = 0
    for item in items:
        start, end = interval(item)
        for day in range((start.date()-week).days, min(WINDOW_DAYS,(end.date()-week).days+1)):
            midnight=datetime.combine(week+timedelta(days=day),time.min,SHANGHAI)
            left=max(0,(start-midnight).total_seconds()/60)
            right=min(DAY_MINUTES,(end-midnight).total_seconds()/60)
            if left<right:additions.setdefault(day,[]).append((left,right))
        minutes += (end-start).total_seconds()/60
    load_cost = rest_cost = 0
    for day, spans in additions.items():
        key = (day, tuple(sorted(spans)))
        costs = context['cost_cache'].get(key)
        if costs is None:
            merged = _study_spans([*context['days'][day], *spans])
            load = sum(end-start for start, end in merged)
            costs = (load**2 - context['loads'][day]**2,
                     _rest_cost(merged, context['settings']) - context['rest'][day])
            if len(context['cost_cache']) < 20000:
                context['cost_cache'][key] = costs
        load_cost += costs[0]
        rest_cost += costs[1]
    settings = context['settings']
    return (settings['daily_load_weight']*load_cost + settings['rest_weight']*rest_cost) / (840*max(1, minutes))


@lru_cache(maxsize=20000)
def dt(value):
    result = datetime.fromisoformat(value) if isinstance(value,str) else value
    if result.tzinfo is None:
        raise ValueError('时间必须带时区。')
    return result.astimezone(SHANGHAI)


def overlaps(a,b,c,d):
    return a < d and c < b


def interval(item):
    return dt(item['start_at']), dt(item['end_at'])


def item_for(task,start):
    return dict(ref=task['ref'],title=task['title'],start_at=start.isoformat(),end_at=(start+timedelta(minutes=task['duration_minutes'])).isoformat())


def old_segments(previous):
    result={}
    for item in previous: result.setdefault(item['ref'],[]).append(item)
    return result


def allowed(task,start,end,week,now,busy,old,fragment=False):
    p=task.get('profile') or {}
    before=old.get(task['ref'],[])
    if isinstance(before,dict): before=[before]
    preserved=any(interval(x)==(start,end) for x in before)
    frozen=p.get('locked') or any(interval(x)[0]<=now<interval(x)[1] for x in before)
    if start<now and not (preserved and start<=now<end):return False
    if not week<=start.date()<week+timedelta(days=WINDOW_DAYS) or end>datetime.combine(week+timedelta(days=WINDOW_DAYS),time.min,SHANGHAI):return False
    if not valid_task_interval(start,end):return False
    minutes=(end-start).total_seconds()/60
    if end>dt(task['deadline']) or minutes<=0 or minutes%GRID_MINUTES:return False
    if not fragment and minutes!=task['duration_minutes']:return False
    if frozen and not preserved:return False
    if p.get('fixed_start') and not fragment and start!=dt(p['fixed_start']):return False
    windows=p.get('allowed_windows') or []
    if windows and not any(dt(w['start_at'])<=start and end<=dt(w['end_at']) for w in windows):return False
    return not any(overlaps(start,end,a,b) for a,b in busy)


def validate_assistant(week,now,tasks,rules,items,previous):
    if any(t.get('task_kind') == 'container' for t in tasks):
        return ['父容器不能直接排程，请选择子任务。']
    old=old_segments([x for x in previous if dt(x['end_at'])>now])
    busy=[(x.start_at,x.end_at) for x in expand_window_rules(week,rules)]
    expected={t['ref']:t for t in tasks}; groups={}; errors=[]
    for x in items:
        ref=x['ref']
        if ref not in expected: errors.append('任务不属于本轮');continue
        groups.setdefault(ref,[]).append(x)
        start,end=interval(x)
        if not allowed(expected[ref],start,end,week,now,busy,old,True):errors.append(f"{expected[ref]['title']}违反时间、截止、冲突或锁定要求")
        busy.append((start,end))
    for ref,t in expected.items():
        segments=sorted(groups.get(ref,[]),key=lambda x:x['start_at']); p=t.get('profile') or {}
        durations=[int((interval(x)[1]-interval(x)[0]).total_seconds()/60) for x in segments]
        if sum(durations)!=t['duration_minutes']:errors.append(f"{t['title']}剩余时长未完整安排")
        limit=p.get('max_segments',4) if p.get('splittable') else 1
        if len(segments)>limit:errors.append('分段数量超过上限')
        if p.get('segment_count') is not None and len(segments)!=p['segment_count']:
            errors.append('实际分段数与指定数量不一致')
        checked=durations if p.get('segment_count') else durations[:-1]
        if len(segments)>1 and any(n<p.get('min_block_minutes',30) for n in checked):errors.append('分段短于最小连续时长')
        if any((interval(right)[0]-interval(left)[1]).total_seconds()/60<p.get('min_break_minutes',0)
            for left,right in zip(segments,segments[1:])):
            errors.append('分段间隔短于指定要求')
        if segments and p.get('fixed_start') and dt(segments[0]['start_at'])!=dt(p['fixed_start']):errors.append('指定开始时间未满足')
        frozen=p.get('locked') or any(interval(x)[0]<=now<interval(x)[1] for x in old.get(ref,[]))
        if frozen and sorted(interval(x) for x in segments)!=sorted(interval(x) for x in old.get(ref,[])):errors.append('锁定或已开始分段被修改')
    return errors


def score(items,tasks,old,week,preferences=None,strategy='balanced',workload=None):
    moved=miss=avoid=temporary_avoid=buffer=distance=early=goal_penalty=preference_capacity=fragments=0
    preferences=preferences or {}
    total_weight=sum(WEIGHTS[t['priority']] for t in tasks.values()) or 1
    grouped=old_segments(items)
    old={k:(v if isinstance(v,list) else [v]) for k,v in old.items()}
    for ref,segments in grouped.items():
        t=tasks[ref]; start=min(interval(x)[0] for x in segments);end=max(interval(x)[1] for x in segments);before=old.get(ref)
        x=segments[0]
        if before and sorted(interval(x) for x in before)!=sorted(interval(x) for x in segments):
            moved+=WEIGHTS[t['priority']]
            distance+=abs((start-min(interval(x)[0] for x in before)).total_seconds())/60
        profile=(t.get('profile') or {})
        if (profile.get('segment_count') or 1)>1:
            preferred=min(30,t['duration_minutes']/profile['segment_count'])
            lengths=[(interval(item)[1]-interval(item)[0]).total_seconds()/60 for item in segments]
            fragments+=WEIGHTS[t['priority']]*sum((max(0,preferred-length)/preferred)**2 for length in lengths)/profile['segment_count']
        preference=profile.get('preferred_windows') or []
        category=(t.get('task_type') or 'other')
        preference_map=preferences.get('task_windows') or {}
        personal=(preference_map.get(category) or [])+(preference_map.get('*') or [])
        preference_capacity+=WEIGHTS[t['priority']]*(bool(preference or personal)+bool((preferences.get('avoid_windows') or [])+(preferences.get('avoid_windows_by_category',{}).get(category,[]) or []))+bool(preferences.get('temporary_avoid_windows')))
        matches=all(any(dt(w['start_at'])<=a and b<=dt(w['end_at']) for w in preference) if preference else any(_personal_window(a,w)[0]<=a and b<=_personal_window(a,w)[1] and (not w.get('weekdays') or a.isoweekday() in w['weekdays']) for w in personal) for a,b in map(interval,segments))
        if (preference or personal) and not matches:miss+=WEIGHTS[t['priority']]
        avoided_windows=(preferences.get('avoid_windows',[]) or [])+(preferences.get('avoid_windows_by_category',{}).get(category,[]) or [])
        if any(overlaps(a,b,*_personal_window(day,w)) and (not w.get('weekdays') or day.isoweekday() in w['weekdays'])
            for a,b in map(interval,segments) for day in (a,b-timedelta(microseconds=1)) for w in avoided_windows):avoid+=WEIGHTS[t['priority']]
        if any(overlaps(a,b,dt(w['start_at']),dt(w['end_at'])) for a,b in map(interval,segments) for w in preferences.get('temporary_avoid_windows',[])):temporary_avoid+=WEIGHTS[t['priority']]
        desired=float((preferences.get('deadline_buffer_by_category',{}).get(category)
                       if category in preferences.get('deadline_buffer_by_category',{})
                       else preferences.get('deadline_buffer_hours',0)) or 0)
        if t['priority']=='high' and desired:
            remaining=max(0,(dt(t['deadline'])-end).total_seconds()/3600)
            buffer+=WEIGHTS[t['priority']]*max(0,desired-remaining)/desired
        start_minutes=(start-datetime.combine(week,time.min,SHANGHAI)).total_seconds()/60
        early+=start_minutes
        goal=(t.get('goal') or {})
        goal_weight=GOAL_WEIGHTS.get(goal.get('priority'),1) if goal and goal.get('status','active')=='active' else 0
        goal_penalty+=goal_weight*WEIGHTS[t['priority']]*max(0,start_minutes)/(14*24*60*total_weight*3)
    weights=STRATEGY_WEIGHTS.get(strategy,STRATEGY_WEIGHTS['balanced'])
    preference_penalty=(miss+avoid+temporary_avoid)/(preference_capacity or 1)
    movement_penalty=moved/total_weight
    buffer_penalty=buffer/total_weight
    composite=(weights[0]*preference_penalty+weights[1]*movement_penalty+weights[2]*buffer_penalty)/sum(weights)
    composite += _workload_penalty(items, week, workload)
    composite += SPLIT_FRAGMENT_WEIGHT*fragments/total_weight
    return composite,movement_penalty,preference_penalty,buffer_penalty,goal_penalty,distance,early,tuple((x['ref'],x['start_at']) for x in items)


def _clock(value):
    hour,minute=map(int,value.split(':')[:2])
    return hour*60+minute


def _personal_window(day, window):
    midnight=datetime.combine(day.date(),time.min,SHANGHAI)
    return tuple(midnight+timedelta(minutes=_clock(window[key])) for key in ('start','end'))


def _schedule_key(items):
    return tuple(sorted((x['ref'],x['start_at'],x['end_at']) for x in items))


def _meaningfully_different(left,right):
    """Prefer a real choice over another five-minute nudge of the same plan."""
    a=old_segments(left); b=old_segments(right)
    for ref in a:
        first=sorted(interval(x) for x in a[ref]); second=sorted(interval(x) for x in b.get(ref,[]))
        if len(first)!=len(second):return True
        if any(abs((x-y).total_seconds())>=1800 for pair,other in zip(first,second) for x,y in zip(pair,other)):
            return True
    return False


def _split_options(task,starts,week,now,busy,old,preferences,strategy):
    """Bounded packing of exact free grid cells; retain one identity and full duration."""
    p=task.get('profile') or {}
    if not p.get('splittable') or p.get('locked'):return []
    frozen=old.get(task['ref'],[])
    if any(interval(x)[0]<=now<interval(x)[1] for x in frozen):return []
    cells=[]
    for start in starts:
        end=start+timedelta(minutes=GRID_MINUTES)
        if allowed(task,start,end,week,now,busy,old,True):cells.append((start,end))
    spans=[]
    for a,b in sorted(set(cells)):
        if spans and spans[-1][1]==a and spans[-1][0].date()==a.date():spans[-1]=(spans[-1][0],b)
        else:spans.append((a,b))
    requested=p.get('segment_count')
    minimum=p.get('min_block_minutes',30)
    def pack(spans,allocation='full',gap=0):
        left=task['duration_minutes']; result=[]
        pending=list(spans)
        while pending:
            a,b=pending.pop(0)
            if any(overlaps(a,b,*interval(item)) for item in result):continue
            fixed=p.get('fixed_start')
            if fixed and not result:
                if not a<=dt(fixed)<b:continue
                a=dt(fixed)
            capacity=int((b-a).total_seconds()/60)
            take=min(capacity,left)
            if requested:
                needed=requested-len(result)
                if needed<=0:break
                if needed==1 and capacity<left:continue
                take=min(take,left-minimum*(needed-1))
                if allocation=='balanced' and needed>1:
                    take=min(take,max(minimum,((left+needed*5-1)//(needed*5))*5))
                if allocation=='capacity' and needed>1:
                    chunks=max(1,needed-len(pending))
                    take=min(take,max(minimum,(min(capacity,left)//(chunks*5))*5))
            if take<p.get('min_block_minutes',30) and take!=left:continue
            if take<=0:continue
            if requested and result:
                if any(abs((a-interval(item)[1]).total_seconds())/60<gap or
                    abs((interval(item)[0]-(a+timedelta(minutes=take))).total_seconds())/60<gap for item in result):continue
            result.append(dict(ref=task['ref'],title=task['title'],start_at=a.isoformat(),end_at=(a+timedelta(minutes=take)).isoformat()))
            left-=take
            if not left:
                return sorted(result,key=lambda x:x['start_at']) if not requested or len(result)==requested else None
            if len(result)>=p.get('max_segments',4):break
            cursor=a+timedelta(minutes=take+gap)
            if requested and cursor<b:pending.insert(0,(cursor,b))
        return None
    orders=[spans, sorted(spans,key=lambda span:(-(span[1]-span[0]).total_seconds(),span[0]))]
    rest_minutes=ceil(_soft_config()['break_minutes']/GRID_MINUTES)*GRID_MINUTES
    if requested:
        anchors=[dt(window['start_at']) for window in p.get('preferred_windows',[])][:14]
        rest=timedelta(minutes=rest_minutes)
        anchors.extend([begin+rest for begin,finish in spans if begin+rest<finish][:28])
        orders.extend([[(max(a,anchor),b) for a,b in spans if b>anchor] for anchor in anchors])
    options=[]
    for ordered in orders:
        preferred_gap=p.get('min_break_minutes') or rest_minutes
        modes=[('balanced',preferred_gap),('capacity',preferred_gap),
            ('balanced',p.get('min_break_minutes',0)),('capacity',p.get('min_break_minutes',0)),
            ('full',p.get('min_break_minutes',0))] if requested else [('full',0)]
        for allocation,gap in modes:
            result=pack(ordered,allocation,gap)
            if result and len(result)>1 and not validate_assistant(week,now,[task],[],result,old.get(task['ref'],[])):
                if not any(_schedule_key(result)==_schedule_key(option) for option in options):options.append(result)
    return options


def _arrange_single(week,now,tasks,rules,previous,allow_alternatives=True,preferences=None,strategy='balanced'):
    until=monotonic()+SEARCH_SECONDS
    old=old_segments([x for x in previous if dt(x['end_at'])>now]); intervals=expand_window_rules(week,rules)
    busy=[(x.start_at,x.end_at) for x in intervals]
    workload = _workload_context(week, tasks, previous, intervals)
    by_ref={t['ref']:t for t in tasks}; choices={}; daily_choices={}; diagnostics=[]
    # Two explicit hard start times cannot be resolved by searching other slots.
    fixed=[t for t in tasks if (t.get('profile') or {}).get('fixed_start') and not (t.get('profile') or {}).get('splittable')]
    for index,left in enumerate(fixed):
        a=dt(left['profile']['fixed_start']);b=a+timedelta(minutes=left['duration_minutes'])
        for right in fixed[index+1:]:
            c=dt(right['profile']['fixed_start']);d=c+timedelta(minutes=right['duration_minutes'])
            if overlaps(a,b,c,d):
                diagnostics.append(dict(ref=left['ref'],code='FIXED_TASK_CONFLICT',message=f"{left['title']}与{right['title']}的指定开始时间冲突；需要先修改其中一项的时间要求。"))
    if diagnostics:return dict(status='conflict',items=[],alternatives=[],diagnostics=diagnostics)
    starts=[datetime.combine(week+timedelta(days=d),time.min,SHANGHAI)+timedelta(minutes=GRID_MINUTES*s) for d in range(WINDOW_DAYS) for s in range(DAY_MINUTES//GRID_MINUTES)]
    starts=[s for s in starts if s>=now]
    for t in tasks:
        before=old.get(t['ref'],[]); p=t.get('profile') or {}
        frozen=p.get('locked') or any(interval(x)[0]<=now<interval(x)[1] for x in before)
        if frozen:
            candidates=[before] if before and not validate_assistant(week,now,[t],rules,before,before) else []
        else:
            # Ordinary automatic suggestions fit a calendar day; a user-specified
            # clock may cross midnight. This avoids rewarding midnight merely
            # because the daily workload counters reset there.
            candidates=[] if (p.get('segment_count') or 1)>1 else [[item_for(t,start)] for start in starts if t['duration_minutes']<=DAY_MINUTES
                and (p.get('fixed_start') or start+timedelta(minutes=t['duration_minutes'])<=datetime.combine(start.date()+timedelta(days=1),time.min,SHANGHAI))
                and allowed(t,start,start+timedelta(minutes=t['duration_minutes']),week,now,busy,old)]
            if not candidates:candidates+=_split_options(t,starts,week,now,busy,old,preferences,strategy)
        candidates.sort(key=lambda pack:(len(pack),score(pack,by_ref,old,week,preferences,strategy,workload)))
        choices[t['ref']]=candidates
        if workload is not None:
            buckets={}
            for index,pack in enumerate(candidates):
                buckets.setdefault(interval(pack[0])[0].date(),[]).append((index,pack))
            daily_choices[t['ref']]=buckets.values()
        if not candidates:
            code='NO_CONTINUOUS_SLOT';message=f"{t['title']}：当前约束下没有完整可用时段。"
            if p.get('fixed_start'):
                a=dt(p['fixed_start']);b=a+timedelta(minutes=t['duration_minutes']);names={r.id:r.title for r in rules}
                conflicts=[names[x.time_rule_id] for x in intervals if overlaps(a,b,x.start_at,x.end_at)]
                if conflicts:code='FIXED_TIME_CONFLICT';message=f"{t['title']}指定的时间与{'、'.join(dict.fromkeys(conflicts))}冲突。"
            diagnostics.append(dict(ref=t['ref'],code=code,message=message))
    if diagnostics:
        alternatives=[]
        if allow_alternatives:
            for t in tasks:
                if not choices[t['ref']] and (t.get('profile') or {}).get('fixed_start') and not (t.get('profile') or {}).get('locked'):
                    relaxed=deepcopy(tasks);next(x for x in relaxed if x['ref']==t['ref'])['profile'].pop('fixed_start',None)
                    result=_arrange_single(week,now,relaxed,rules,previous,False,preferences,strategy)
                    if result['status']=='ready':
                        for solution in [result['items']]+result['alternatives']:
                            found=next(x for x in solution if x['ref']==t['ref'])
                            alternatives.append(dict(ref=t['ref'],start_at=found['start_at'],end_at=found['end_at'],requires_time_change=True))
                    break
        return dict(status='conflict' if alternatives or any(x['code']=='FIXED_TIME_CONFLICT' for x in diagnostics) else 'no_plan',items=[],alternatives=alternatives[:2],diagnostics=diagnostics)
    ordered=sorted(tasks,key=lambda t:(len(choices[t['ref']]),t['deadline'],-WEIGHTS[t['priority']],(t.get('goal') or {}).get('priority',3),t['ref']))
    beam=[[]]; expansions=0
    for t in ordered:
        expanded=[]
        for state in beam:
            occupied=[interval(x) for x in state]
            candidates=[]
            covered=[]
            if workload is not None:
                # Reuse day buckets instead of rescanning the entire fortnight
                # for every beam state. Retain the global ranking order exactly.
                for bucket in daily_choices[t['ref']]:
                    count=0
                    for index,pack in bucket:
                        if any(overlaps(*interval(x),a,b) for x in pack for a,b in occupied):continue
                        covered.append((index,pack));count+=1
                        if count==4:break
                covered.sort(key=lambda entry:entry[0])
                candidates=[pack for _,pack in covered]
            selected={index for index,_ in covered}
            for index,pack in enumerate(choices[t['ref']]):
                if index in selected or any(overlaps(*interval(x),a,b) for x in pack for a,b in occupied):continue
                candidates.append(pack)
                if len(candidates)==64:break
            if not candidates and (t.get('profile') or {}).get('splittable'):
                candidates+=_split_options(t,starts,week,now,busy+occupied,old,preferences,strategy)
            # Score each expanded state once before applying the beam cap.
            ranked=[]
            for pack in candidates:
                solution=state+pack
                ranked.append((len(pack),score(solution,by_ref,old,week,preferences,strategy,workload),solution))
            ranked.sort(key=lambda entry:entry[:2])
            for _,rank,solution in ranked[:64]:
                expansions+=1
                limit='expansions' if expansions>SEARCH_EXPANSIONS else 'time' if monotonic()>until else None
                if limit:
                    reason='扩展次数' if limit=='expansions' else '时间'
                    return dict(status='no_plan',items=[],alternatives=[],diagnostics=[dict(code='SEARCH_LIMIT',
                        budget_kind=limit, expansions=expansions, phase='search',
                        message=f'有界搜索达到{reason}上限，未找到完整方案；不等于数学上无解。')])
                expanded.append((len(solution),rank,solution))
        if not expanded:return dict(status='no_plan',items=[],alternatives=[],diagnostics=[dict(code='NO_PLAN_FOUND',message='有界搜索未找到完整方案；这不等于证明无解。')])
        expanded.sort(key=lambda entry:entry[:2])
        beam=[entry[2] for entry in expanded[:64]]
        if workload is not None:
            # Reserve one original-ranking path inside the existing beam cap.
            # A tight deadline can require packing without the preferred gaps.
            weights=STRATEGY_WEIGHTS.get(strategy,STRATEGY_WEIGHTS['balanced'])
            def original_order(entry):
                rank=entry[1]
                composite=(weights[0]*rank[2]+weights[1]*rank[1]+weights[2]*rank[3])/sum(weights)
                return entry[0], (composite,*rank[1:])
            guard=min(expanded,key=original_order)[2]
            if not any(_schedule_key(state)==_schedule_key(guard) for state in beam):
                beam[-1]=guard
    pool=[];seen=set()
    for state in beam:
        key=_schedule_key(state)
        if key in seen:continue
        seen.add(key)
        pool.append(sorted(state,key=lambda x:(x['start_at'],x['ref'])))
    solutions=pool[:1]
    for meaningful in (True,False):
        for state in pool[1:]:
            if len(solutions)>=3:break
            if any(_schedule_key(state)==_schedule_key(x) for x in solutions):continue
            if meaningful and not all(_meaningfully_different(state,x) for x in solutions):continue
            solutions.append(state)
    for state in solutions:
        if validate_assistant(week,now,tasks,rules,state,previous):raise RuntimeError('排程未通过独立校验')
    return dict(status='ready',items=solutions[0] if solutions else [],alternatives=solutions[1:],diagnostics=[])


def arrange(week,now,tasks,rules,previous,allow_alternatives=True,preferences=None,include_strategies=False):
    """Return verified schedules; personal preferences only affect soft ranking."""
    if not include_strategies:
        return _arrange_single(week,now,tasks,rules,previous,allow_alternatives,preferences)
    options=[]; errors=[]; seen=set(); results=[]
    def append_option(strategy,items):
        key=_schedule_key(items)
        if key in seen:return
        if validate_assistant(week,now,tasks,rules,items,previous):
            raise RuntimeError('排程未通过独立校验')
        seen.add(key)
        options.append({'candidate_id':strategy+':'+str(len(options)),'strategy':strategy,'items':items,'metrics':{**_metrics(items,tasks,previous,week,preferences),'strategy_weights':list(STRATEGY_WEIGHTS[strategy])}})
    for strategy in ('balanced','preference','stable'):
        result=_arrange_single(week,now,tasks,rules,previous,allow_alternatives,preferences,strategy)
        if result['status']!='ready':
            errors.extend(result.get('diagnostics',[])); continue
        results.append((strategy,result))
        append_option(strategy,result['items'])
    # Keep distinct strategy winners first, then use their verified runners-up.
    # Do not relax hard constraints or invent another strategy label to fill cards.
    for meaningful in (True,False):
        for strategy,result in results:
            for items in result.get('alternatives',[]):
                if len(options)>=3:break
                if meaningful and not all(_meaningfully_different(items,x['items']) for x in options):continue
                append_option(strategy,items)
    if not options:
        fallback=_arrange_single(week,now,tasks,rules,previous,allow_alternatives,preferences)
        return {**fallback,'candidate_options':[],'search_diagnostics':errors}
    preferred=next((x for x in options if x['strategy']==(preferences or {}).get('adjustment_mode','balanced')),options[0])
    return {'status':'ready','items':preferred['items'],'alternatives':[x['items'] for x in options if x is not preferred][:2],'candidate_options':options,'diagnostics':[],'search_diagnostics':errors}


def _metrics(items,tasks,previous,week,preferences):
    old=old_segments(previous); by_ref={x['ref']:x for x in tasks}
    total=sum(WEIGHTS[t['priority']] for t in tasks) or 1
    moved=preference_misses=avoided=temporary_avoided=buffer_hours=0
    for ref,segments in old_segments(items).items():
        task=by_ref[ref]; a=min(interval(x)[0] for x in segments);b=max(interval(x)[1] for x in segments);weight=WEIGHTS[task['priority']]
        if ref in old and sorted(interval(x) for x in old[ref])!=sorted(interval(x) for x in segments):moved+=weight
        category=task.get('task_type') or 'other'; preference_map=(preferences or {}).get('task_windows',{}); windows=(preference_map.get(category) or [])+(preference_map.get('*') or [])
        task_windows=(task.get('profile') or {}).get('preferred_windows') or []
        matches=all(any(dt(w['start_at'])<=start and end<=dt(w['end_at']) for w in task_windows) if task_windows else any(start.hour*60+start.minute>=_clock(w['start']) and end.hour*60+end.minute<=_clock(w['end']) and (not w.get('weekdays') or start.isoweekday() in w['weekdays']) for w in windows) for start,end in map(interval,segments))
        if (task_windows or windows) and not matches:preference_misses+=weight
        avoided_windows=((preferences or {}).get('avoid_windows',[]) or [])+((preferences or {}).get('avoid_windows_by_category',{}).get(category,[]) or [])
        if any(start.hour*60+start.minute<_clock(w['end']) and _clock(w['start'])<end.hour*60+end.minute and (not w.get('weekdays') or start.isoweekday() in w['weekdays']) for start,end in map(interval,segments) for w in avoided_windows):avoided+=weight
        if any(overlaps(start,end,dt(w['start_at']),dt(w['end_at'])) for start,end in map(interval,segments) for w in (preferences or {}).get('temporary_avoid_windows',[])):temporary_avoided+=weight
        prefs=preferences or {}; buffers=prefs.get('deadline_buffer_by_category',{})
        desired=float((buffers.get(category) if category in buffers else prefs.get('deadline_buffer_hours',0)) or 0)
        if task['priority']=='high' and desired: buffer_hours+=max(0,desired-(dt(task['deadline'])-b).total_seconds()/3600)
    return {'changed_tasks_weight':moved,'total_tasks_weight':total,'preference_misses_weight':preference_misses,'avoided_tasks_weight':avoided,'temporary_avoided_tasks_weight':temporary_avoided,'deadline_buffer_shortfall_hours':round(buffer_hours,1)}
