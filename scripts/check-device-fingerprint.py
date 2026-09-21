"""
对照 dYmanager 存的设备指纹与 Cookie 里抖音页面自报的硬件，排查风控。
只输出结论，不会打印 Cookie。用法：python3 scripts/check-device-fingerprint.py
"""
import json
import os
import platform
import re
import sqlite3
import sys
import urllib.parse

CANDIDATES = [
    os.path.expandvars(r'%APPDATA%\dym\data.db'),
    os.path.expanduser('~/Library/Application Support/dym/data.db'),
    os.path.expanduser('~/.config/dym/data.db'),
]


def find_db():
    for path in CANDIDATES:
        if os.path.exists(path):
            return path
    sys.exit('找不到 data.db，请把路径加进 CANDIDATES')


def page_hardware(cookie):
    match = re.search(r'stream_recommend_feed_params=([^;]*)', cookie)
    if not match:
        return {}
    raw = urllib.parse.unquote(match.group(1))
    pattern = r'\\?"(screen_width|screen_height|cpu_core_num|device_memory)\\?"\s*:\s*(\d+)'
    return {key: int(value) for key, value in re.findall(pattern, raw)}


def main():
    db = find_db()
    print('数据库 :', db)
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)

    def setting(key):
        row = con.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row[0] if row else None

    profile_raw = setting('douyin_device_profile')
    if not profile_raw:
        sys.exit('没有 douyin_device_profile，应用还没用 v3.0.0 启动过？')
    profile = json.loads(profile_raw)
    hw = page_hardware(setting('douyin_cookie') or '')
    system = platform.system()
    real_os = {'Windows': 'windows', 'Darwin': 'mac'}.get(system, system.lower())

    print('\n--- 签名自报（polydl 发给抖音的） ---')
    print(f"  os          : {profile.get('os')}")
    print(f"  UA          : {profile.get('userAgent')}")
    print(f"  屏幕        : {profile.get('screenWidth')} x {profile.get('screenHeight')}")
    print(f"  CPU / 内存  : {profile.get('cpuCores')} 核 / {profile.get('deviceMemory')} GB")
    print('\n--- 页面自报（抖音 JS 写进 Cookie 的） ---')
    print(f"  屏幕        : {hw.get('screen_width')} x {hw.get('screen_height')}")
    print(f"  CPU / 内存  : {hw.get('cpu_core_num')} 核 / {hw.get('device_memory')} GB")
    print('\n--- 本机真实 ---')
    print(f'  os          : {real_os}  ({platform.platform()})')
    print(f'  CPU 逻辑核心: {os.cpu_count()}')

    print('\n=== 判定 ===')
    problems = []
    if profile.get('os') != real_os:
        problems.append(f"OS 不符   : 签名说 {profile.get('os')}，实际是 {real_os}  <<< 最严重")
    if hw.get('screen_width') and profile.get('screenWidth') != hw['screen_width']:
        problems.append(
            f"屏幕不符  : 签名 {profile.get('screenWidth')}x{profile.get('screenHeight')}"
            f"  vs  页面 {hw['screen_width']}x{hw['screen_height']}"
        )
    if hw.get('cpu_core_num') and profile.get('cpuCores') != hw['cpu_core_num']:
        problems.append(f"CPU 不符  : 签名 {profile.get('cpuCores')}  vs  页面 {hw['cpu_core_num']}")
    for problem in problems:
        print('  !!', problem)
    if not problems:
        print('  指纹一致，问题不在这里。')


if __name__ == '__main__':
    main()
