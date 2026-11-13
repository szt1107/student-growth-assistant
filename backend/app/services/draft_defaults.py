"""Trusted, bounded defaults from user messages only; no model output or I/O.

Precedence: current user > earlier user > confirmed preference > defaults.
The parser deliberately covers common Chinese expressions, not arbitrary prose.
"""
import re
from copy import deepcopy
from datetime import datetime, time, timedelta
from ..workspace_schemas import SchedulePreview, DRAFT_DEFAULTS
from .assistant_clock import SHANGHAI

DEFAULTS = DRAFT_DEFAULTS
STARTS = {'早上': '09:00', '明早': '09:00', '上午': '09:00', '中午': '12:00', '下午': '14:00',
    '晚上': '19:00', '今晚': '19:00', '明晚': '19:00'}
TIME_PERIODS = {
    'morning': ('08:00', '12:00', '上午'),
    'noon': ('12:00', '14:00', '中午'),
    'afternoon': ('14:00', '18:00', '下午'),
    'evening': ('18:00', '22:00', '晚上'),
}
START_PERIODS = {'09:00': 'morning', '12:00': 'noon', '14:00': 'afternoon', '19:00': 'evening'}
NUMBER = r'(?:\d+(?:\.\d+)?|[零一二两三四五六七八九十百]+)'


def day_window(day, period=None):
    begin, end, _ = TIME_PERIODS.get(period, ('08:00', '22:00', '全天'))
    return (datetime.combine(day, time.fromisoformat(begin), SHANGHAI),
        datetime.combine(day, time.fromisoformat(end), SHANGHAI))


def number(text):
    if re.fullmatch(r'\d+(?:\.\d+)?', text):return float(text)
    digits = dict(zip('零一二三四五六七八九', range(10)));digits['两'] = 2
    if text == '十':return 10
    if '十' in text:
        a, b = text.split('十', 1)
        return digits.get(a, 1)*10 + digits.get(b, 0)
    return digits.get(text)


def duration(text):
    text = re.sub(r'(休息|每段)\s*'+NUMBER+r'\s*分钟', '', text)
    match = re.search('('+NUMBER+r')(?:个)?半小时', text)
    if match and number(match[1]) is not None:return int((number(match[1])+.5)*60)
    if '半小时' in text:return 30
    match = re.search('('+NUMBER+r')\s*(?:个)?小时(?:\s*('+NUMBER+r')\s*分钟)?', text)
    if match and number(match[1]) is not None:return int(number(match[1])*60+(number(match[2]) if match[2] else 0))
    match = re.search('('+NUMBER+r')\s*分钟', text)
    if match and number(match[1]) is not None:return int(number(match[1]))


def clock(text):
    # An adjacent YYYY-MM-DD must not merge its day with the hour (2822:00).
    text = re.sub(r'20\d{2}-\d{2}-\d{2}', '', text)
    match = re.search(r'(?:(早上|上午|中午|下午|晚上|今晚|明晚)\s*)?('+NUMBER+r')(?:点|[:：])(?:(半)|('+NUMBER+r')(?:分)?)?', text)
    if not match:return None
    hour = number(match[2]);minute = 30 if match[3] else number(match[4]) if match[4] else 0
    if hour is None or minute is None:return None
    if match[1] in ('下午','晚上','今晚','明晚') and hour<12:hour+=12
    if 0<=hour<24 and 0<=minute<60:return f'{int(hour):02}:{int(minute):02}'


def fixed_start_requested(text):
    if re.search(r'不用固定|不必固定|不需要固定|不固定|可以调整|允许调整|自动避开|时间灵活',text):
        return False
    return bool(re.search(r'(必须|务必|一定要|只能|固定在?|准时|就定在|严格按).{0,8}'+NUMBER+r'(点|[:：])|'
        r'(开始时间|起始时间).{0,6}(固定|不能改|不可调整)|时间不能改|不能改时间',text))


def calendar_day(text, now, reference=None):
    day = None
    for words, offset in [(('今天', '今晚'), 0), (('明天', '明晚', '明早'), 1),
            (('后天',), 2), (('大后天',), 3)]:
        if any(word in text for word in words):
            day = now.date() + timedelta(days=offset)
    if reference and re.search(r'次日|第二天', text):
        day = reference + timedelta(days=1)
    weekday = re.search(r'((?:下|本|这)?(?:周|星期|礼拜))([一二三四五六日天])', text)
    if weekday:
        index = '一二三四五六日'.find(weekday[2].replace('天', '日'))
        day = now.date() - timedelta(days=now.weekday()) + timedelta(days=index + (7 if weekday[1].startswith('下') else 0))
    month_day = re.search(r'(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})[日号]?', text)
    if month_day:
        day = datetime(int(month_day[1] or now.year), int(month_day[2]), int(month_day[3])).date()
    date_match = re.search(r'20\d{2}-\d{2}-\d{2}', text)
    if date_match:
        day = datetime.fromisoformat(date_match[0]).date()
    return day


def user_values(text, now, *, reference_day=None):
    # Instructions inside quotations/code do not authorize a fallback. Routing
    # is checked separately; here preserve a quoted task name as data.
    text = re.sub(r'```[\s\S]*?```|`[^`]*`', '', text)[:2000]
    values = {}
    minutes = duration(text)
    if minutes is not None:values['duration_minutes'] = minutes
    priority=re.search(r'优先级(?:设为|是|改成|为)?(高|普通|正常|低)',text)
    if priority:values['priority']={'高':'high','普通':'normal','正常':'normal','低':'low'}[priority[1]]
    # A deadline clock is not a preferred start clock.
    deadline_match = re.search(r'(?:截止(?:时间)?(?:是|到|为)?|DDL[：: ]*|最晚)(.{1,35})|([^，。；]{0,30}(?:点|:\d{2}|早上|上午|中午|下午|晚上)(?:半)?(?:前(?:完成|交|提交)?|截止))',text,re.I)
    execution = text[:deadline_match.start()] if deadline_match else text
    day = calendar_day(execution, now)
    if day:
        values['day'] = day.isoformat()
    for word, start in STARTS.items():
        if word in execution:
            values['start_time'] = start
            values['time_period'] = START_PERIODS[start]
    if deadline_match:
        part = deadline_match[1] or deadline_match[2]
        at = clock(part)
        if not at:
            at = next((start for word, start in STARTS.items() if word in part), None)
        if at:
            deadline_day = calendar_day(part, now, reference=day or reference_day) or day or reference_day or now.date()
            values['deadline'] = datetime.combine(deadline_day,time.fromisoformat(at),SHANGHAI).isoformat()
        before=text[:deadline_match.start()]
        at=clock(before)
        if at:values['start_time']=at;values['start_exact']=fixed_start_requested(before)
        if re.match(r'^(截止|最晚|DDL)',text,re.I):values.pop('day',None)
    else:
        at = clock(text)
        if at:values['start_time'] = at;values['start_exact']=fixed_start_requested(text)
    if re.search(r'可以调整|允许调整|自动避开|时间灵活|不固定',text):values['start_exact']=False
    for title_text in re.split(r'[，,。；;\n]',text):
        title_text = re.sub(r'(?:下|本|这)?(?:周|星期|礼拜)[一二三四五六日天]|(?:(?:20\d{2})年)?\d{1,2}月\d{1,2}[日号]?', '',title_text)
        title_text = re.sub(r'20\d{2}-\d{2}-\d{2}|'+NUMBER+r'(?:个)?半?小时|半小时|'+NUMBER+r'分钟', '',title_text)
        title_text = re.sub(r'(?:早上|上午|中午|下午|晚上|今晚|明晚)?'+NUMBER+r'(?:点|[:：])(?:半|'+NUMBER+r'分?)?', '',title_text)
        title_text = re.sub(r'(?:帮我|请)?(?:生成|创建|新建).{0,6}(?:草案|初稿)', '',title_text)
        # A colon after the task name introduces details, not a replacement name.
        title_text = re.sub(r'^(?:任务名称|任务|名称|标题)[：:]\s*','',title_text)
        title_text = re.sub(r'^(?:我|请|你|帮我|今天|今晚|明天|明晚|明早|早上|晚上|上午|下午|要|想|打算|准备|计划|用来|用于|必须|务必|准时|固定|只能|开始|有个|有一个|需要|完成|写|安排一下|安排|排一下|排|创建|新建|把|将|给我|做|一下|\s|：|:)+', '',title_text)
        match = re.search(r'([\u4e00-\u9fffA-Za-z0-9 ]{0,60}?(?:作业|实验报告|报告|实验|论文|考试|复习|项目|阅读|笔记|早读|读书|健身|训练|跑步|锻炼|游泳|瑜伽|散步|[pP][pP][tT]))',title_text)
        if match:
            values['title'] = match[1].strip(' “”“');break
    segment = re.search(r'(?:分成|分为|分)('+NUMBER+r')段',text)
    if segment and number(segment[1]) is not None:values['segments'] = int(number(segment[1]))
    if not segment and re.search(r'允许分段|可以分段|可分段|帮我分段|允许拆分',text):values['segments']=2
    if re.search(r'不允许分段|不要分段|不用分段|不分段|取消分段',text):values['segments']=1
    each = re.search(r'每段('+NUMBER+r')分钟',text)
    if each and 'segments' in values:
        values['duration_minutes'] = int(number(each[1])*values['segments'])
        values['min_block_minutes'] = int(number(each[1]))
    rest = re.search(r'休息('+NUMBER+r')分钟',text)
    if rest and number(rest[1]) is not None:values['break_minutes'] = int(number(rest[1]))
    return values


def independent_schedule(text, now):
    """A complete new occasion does not identify an old task with the same name."""
    if re.search(r'修改|改成|改到|调整|重新安排|重排|挪|移动|推迟|延后|提前|原来|之前|已有|原任务|这个任务|该任务|任务\s*#?\d|task:\d',text):
        return False
    values=user_values(text,now)
    return all(key in values for key in ('title','day','start_time','duration_minutes'))


def constrain_actions(actions, text, now):
    """Keep a user's dated request hard even when the model calls it a preference.

    Only the current message can replace a date. For multiple tasks, use the
    clause naming each task so one task's date cannot spill into another.
    Other task fields and profile flags remain in the original action format.
    """
    result=deepcopy(actions)
    for action in result:
        fields=action['fields']
        scoped=text
        if len(result)>1:
            title=fields.get('title')
            scoped='。'.join(part for part in re.split(r'[，,。；;\n]',text) if title and title in part)
        values=user_values(scoped,now)
        if 'day' not in values:continue
        day=datetime.fromisoformat(values['day']).date()
        start=datetime.combine(day,time.fromisoformat(values.get('start_time','08:00')),SHANGHAI)
        begin,end=day_window(day,values.get('time_period'))
        if values.get('start_exact'):begin=start
        profile=fields.setdefault('profile',{})
        profile.update(allowed_windows=[{'start_at':begin.isoformat(),'end_at':end.isoformat()}],
            preferred_windows=[{'start_at':max(begin,min(start,end-timedelta(minutes=5))).isoformat(),'end_at':end.isoformat()}],
            fixed_start=start.isoformat() if values.get('start_exact') else None)
        for key in ('duration_minutes','deadline','priority'):
            if key in values:fields[key]=values[key]
        if action['op']=='update' and 'deadline' not in values:
            fields.pop('deadline',None)
    return result


def schedule(request, now, *, base=None, sources=None, preferences=None):
    values = {**DEFAULTS, 'day': now.date().isoformat(), **(base or {})}
    origins = {key:'system_default' for key in values}
    origins.update(sources or {})
    # Only actual confirmed settings supplied by the caller. Sample preferences
    # never get labelled as a user decision.
    windows = (preferences or {}).get('task_windows',{}).get('*',[])
    history = [] if base or independent_schedule(request['message'],now) else [m['text'] for m in request.get('history',[]) if m.get('role')=='user'][-8:]
    for text in history:
        parsed=user_values(text,now,reference_day=datetime.fromisoformat(str(values['day'])).date())
        for key,value in parsed.items():
            values[key]=value;origins[key]='system_default' if key=='start_time' and 'start_exact' not in parsed else 'conversation_context'
    parsed=user_values(request['message'],now,reference_day=datetime.fromisoformat(str(values['day'])).date())
    if base and parsed.get('start_time') and 'start_exact' in parsed and int(parsed['start_time'][:2])<12 and int(base['start_time'][:2])>=12 and not re.search(r'早上|上午|中午|凌晨|下午|晚上|今晚|明晚|明早',request['message']):
        parsed['start_time']=f"{int(parsed['start_time'][:2])+12:02}"+parsed['start_time'][2:]
    for key,value in parsed.items():
        values[key]=value;origins[key]='system_default' if key=='start_time' and 'start_exact' not in parsed else 'user_explicit'
    if 'start_time' in parsed and 'time_period' not in parsed and values.get('time_period'):
        begin,end,_=TIME_PERIODS[values['time_period']]
        if not begin<=values['start_time']<end:
            values['time_period']=None;origins['time_period']='user_explicit'
    if re.search(r'不限时段|任何时段|任意时段|全天都可以|取消时段限制',request['message']):
        values['time_period']=None;origins['time_period']='user_explicit'
    if base and any(key in parsed for key in ('day','start_time','duration_minutes','segments','break_minutes')):
        values['work_segments']=[]
    if not base and origins['start_time']=='system_default':
        weekday=datetime.fromisoformat(str(values['day'])).isoweekday()
        begin,end,_=TIME_PERIODS.get(values.get('time_period'),('08:00','22:00','全天'))
        applicable=[w for w in windows if (not w.get('weekdays') or weekday in w['weekdays'])
            and begin<=w['start']<end and w['end']>begin and w['start']>=values['start_time']]
        if applicable:values['start_time']=applicable[0]['start'];origins['start_time']='confirmed_preference'
    if values['title']=='待命名任务':origins['title']='unresolved'
    if not values.get('deadline'):origins['deadline']='unresolved'
    return SchedulePreview.model_validate(values), origins


def review_range(text, now):
    day=now.date()
    if '今天' in text:return day,day+timedelta(days=1),'day'
    if '昨天' in text:return day-timedelta(days=1),day,'day'
    if '本月' in text or '这个月' in text:
        start=day.replace(day=1);end=(start+timedelta(days=32)).replace(day=1)
        return start,end,'month'
    start=day-timedelta(days=day.weekday())
    return start,start+timedelta(days=7),'week'
