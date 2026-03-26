import * as vscode from 'vscode';

interface FileData {
  timeMs: number;
  cost: number;
}

interface DailyData {
  date: string;
  totalTimeMs: number;
  totalCost: number;
  files: { [filePath: string]: FileData };
}

interface HistoryData {
  [date: string]: DailyData;
}

class TimeTracker {
  private statusBarItem: vscode.StatusBarItem;
  private lastActiveTime: number = 0;
  private lastActiveFile: string = '';
  private isTracking: boolean = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'worthycode.showStats';
    this.statusBarItem.tooltip = 'Click to view today\'s stats';
    this.statusBarItem.show();

    this.checkDateChange();
    this.updateStatusBar();
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration('worthycode');
    return {
      hourlyRate: config.get<number>('hourlyRate', 30000),
      idleTimeout: config.get<number>('idleTimeout', 60) * 1000,
      currency: config.get<string>('currency', '$')
    };
  }

  private getTodayData(): DailyData {
    const today = this.getToday();
    const history = this.getHistory();

    if (history[today]) {
      return history[today];
    }

    return {
      date: today,
      totalTimeMs: 0,
      totalCost: 0,
      files: {}
    };
  }

  private async saveTodayData(data: DailyData) {
    const history = this.getHistory();
    history[data.date] = data;
    await this.context.globalState.update('history', history);
  }

  private getHistory(): HistoryData {
    return this.context.globalState.get<HistoryData>('history', {});
  }

  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  private checkDateChange() {
    const today = this.getToday();
    const history = this.getHistory();

    if (!history[today]) {
      this.saveTodayData({
        date: today,
        totalTimeMs: 0,
        totalCost: 0,
        files: {}
      });
    }
  }

  private getCurrentFile(): string {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      return editor.document.uri.fsPath;
    }
    return '';
  }

  onUserActivity() {
    const now = Date.now();
    const config = this.getConfig();
    const currentFile = this.getCurrentFile();

    if (this.isTracking && this.lastActiveTime > 0) {
      const elapsed = now - this.lastActiveTime;

      if (elapsed < config.idleTimeout) {
        const data = this.getTodayData();
        data.totalTimeMs += elapsed;
        data.totalCost = this.calculateCost(data.totalTimeMs);

        // File tracking
        if (this.lastActiveFile) {
          if (!data.files[this.lastActiveFile]) {
            data.files[this.lastActiveFile] = { timeMs: 0, cost: 0 };
          }
          data.files[this.lastActiveFile].timeMs += elapsed;
          data.files[this.lastActiveFile].cost = this.calculateCost(
            data.files[this.lastActiveFile].timeMs
          );
        }

        this.saveTodayData(data);
      }
    }

    this.lastActiveTime = now;
    this.lastActiveFile = currentFile;

    if (!this.isTracking) {
      this.startTracking();
    }

    this.resetIdleTimer();
  }

  private calculateCost(timeMs: number): number {
    const config = this.getConfig();
    const hours = timeMs / (1000 * 60 * 60);
    return Math.round(hours * config.hourlyRate);
  }

  private startTracking() {
    this.isTracking = true;
    this.lastActiveTime = Date.now();

    if (!this.updateTimer) {
      this.updateTimer = setInterval(() => {
        this.updateStatusBar();
      }, 1000);
    }
  }

  private pauseTracking() {
    this.isTracking = false;
    this.updateStatusBar();
  }

  private resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    const config = this.getConfig();
    this.idleTimer = setTimeout(() => {
      this.pauseTracking();
    }, config.idleTimeout);
  }

  private updateStatusBar() {
    const data = this.getTodayData();
    const config = this.getConfig();

    const timeStr = this.formatTime(data.totalTimeMs);
    const costStr = this.formatCost(data.totalCost, config.currency);
    const icon = this.isTracking ? '$(credit-card)' : '$(debug-pause)';

    this.statusBarItem.text = `${icon} ${costStr} | $(clock) ${timeStr}`;
  }

  private formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private formatCost(cost: number, currency: string): string {
    return `${currency}${cost.toLocaleString()}`;
  }

  showStats() {
    const data = this.getTodayData();
    const config = this.getConfig();

    const timeStr = this.formatTime(data.totalTimeMs);
    const costStr = this.formatCost(data.totalCost, config.currency);
    const hourlyStr = this.formatCost(config.hourlyRate, config.currency);

    const lines = [
      `Today (${data.date})`,
      ``,
      `Work time: ${timeStr}`,
      `Earned: ${costStr}`,
      ``,
      `Hourly rate: ${hourlyStr}/h`
    ];

    vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  }

  async showFileStats() {
    const data = this.getTodayData();
    const config = this.getConfig();

    const fileEntries = Object.entries(data.files)
      .sort((a, b) => b[1].timeMs - a[1].timeMs)
      .slice(0, 10);

    if (fileEntries.length === 0) {
      vscode.window.showInformationMessage('No file data yet.');
      return;
    }

    const lines = [`Top Files (Today)`, ``];

    fileEntries.forEach(([file, fileData], index) => {
      const timeStr = this.formatTime(fileData.timeMs);
      const costStr = this.formatCost(fileData.cost, config.currency);
      const fileName = file.split('/').pop() || file;
      lines.push(`${index + 1}. ${fileName}: ${timeStr} (${costStr})`);
    });

    vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  }

  showDashboard() {
    const panel = vscode.window.createWebviewPanel(
      'worthycodeDashboard',
      'WorthyCode Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const updateDashboard = () => {
      const data = this.getTodayData();
      const history = this.getHistory();
      const config = this.getConfig();

      const dates = Object.keys(history).sort((a, b) => b.localeCompare(a)).slice(0, 7);
      const historyData = dates.map(date => ({
        date,
        time: history[date].totalTimeMs,
        cost: history[date].totalCost
      }));

      const fileEntries = Object.entries(data.files)
        .sort((a, b) => b[1].timeMs - a[1].timeMs)
        .slice(0, 5)
        .map(([file, fileData]) => ({
          name: file.split('/').pop() || file,
          path: file,
          time: fileData.timeMs,
          cost: fileData.cost
        }));

      // 히트맵 데이터 생성 (최근 1년, 일요일부터 시작)
      const heatmapData: { date: string; cost: number; dayOfWeek: number }[] = [];
      const today = new Date();
      // 시작일을 약 1년 전 일요일로 맞추기
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 364);
      // 가장 가까운 이전 일요일로 조정
      const dayOffset = startDate.getDay();
      startDate.setDate(startDate.getDate() - dayOffset);

      const endDate = new Date(today);
      const d = new Date(startDate);
      while (d <= endDate) {
        const dateStr = d.toISOString().split('T')[0];
        heatmapData.push({
          date: dateStr,
          cost: history[dateStr]?.totalCost || 0,
          dayOfWeek: d.getDay()
        });
        d.setDate(d.getDate() + 1);
      }

      // 확장자별 데이터 생성
      const extMap: { [ext: string]: number } = {};
      Object.entries(data.files).forEach(([file, fileData]) => {
        const ext = file.includes('.') ? '.' + file.split('.').pop() : 'other';
        extMap[ext] = (extMap[ext] || 0) + fileData.cost;
      });
      const extData = Object.entries(extMap)
        .map(([ext, cost]) => ({ ext, cost }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);

      panel.webview.html = this.getDashboardHtml(data, historyData, fileEntries, config, heatmapData, extData);
    };

    updateDashboard();

    const interval = setInterval(updateDashboard, 1000);
    panel.onDidDispose(() => clearInterval(interval));

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'openFile') {
        try {
          const doc = await vscode.workspace.openTextDocument(message.path);
          await vscode.window.showTextDocument(doc);
        } catch (e) {
          vscode.window.showErrorMessage(`Cannot open file: ${message.path}`);
        }
      }
    });
  }

  private getDashboardHtml(
    today: DailyData,
    history: { date: string; time: number; cost: number }[],
    files: { name: string; path: string; time: number; cost: number }[],
    config: { hourlyRate: number; currency: string },
    heatmap: { date: string; cost: number; dayOfWeek: number }[],
    extData: { ext: string; cost: number }[]
  ): string {
    const formatTime = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
    };

    const formatCost = (cost: number) => `${config.currency}${cost.toLocaleString()}`;
    const maxCost = Math.max(...history.map(h => h.cost), 1);
    const maxHeatmapCost = Math.max(...heatmap.map(h => h.cost), 1);
    const weekTotal = history.reduce((sum, h) => sum + h.cost, 0);
    const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const getHeatmapColor = (cost: number) => {
      if (cost === 0) return 'rgba(255,255,255,0.08)';
      const intensity = cost / maxHeatmapCost;
      if (intensity < 0.25) return '#3b5998';
      if (intensity < 0.5) return '#5b7bc0';
      if (intensity < 0.75) return '#7b9bd8';
      return '#a5b4fc';
    };

    // 주 단위로 그룹화 (일요일이 맨 위)
    const weeks: { date: string; cost: number; dayOfWeek: number }[][] = [];
    for (let i = 0; i < heatmap.length; i += 7) {
      weeks.push(heatmap.slice(i, i + 7));
    }

    // 도넛 차트 데이터
    const donutColors = ['#667eea', '#764ba2', '#f093fb', '#4ade80', '#fbbf24', '#f87171', '#38bdf8', '#a78bfa', '#fb923c', '#2dd4bf'];
    const totalExtCost = extData.reduce((sum, e) => sum + e.cost, 0);
    let cumulativePercent = 0;
    const donutSegments = extData.map((e, i) => {
      const percent = totalExtCost > 0 ? (e.cost / totalExtCost) * 100 : 0;
      const startPercent = cumulativePercent;
      cumulativePercent += percent;
      return {
        ...e,
        color: donutColors[i % donutColors.length],
        percent,
        startPercent
      };
    });

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #eee;
      padding: 32px;
      min-height: 100vh;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      animation: slideUp 0.5s ease-out;
    }
    .header h1 {
      font-size: 42px;
      font-weight: 700;
      letter-spacing: -1px;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: none;
    }
    .header .subtitle {
      font-size: 13px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 3px;
      margin-bottom: 12px;
    }
    .header .date {
      font-size: 15px;
      color: #aaa;
      font-weight: 500;
    }
    .main-stat {
      text-align: center;
      padding: 40px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 20px;
      margin-bottom: 24px;
      box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
      animation: slideUp 0.6s ease-out;
    }
    .main-stat .label {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: rgba(255,255,255,0.8);
      margin-bottom: 8px;
    }
    .main-stat .value {
      font-size: 42px;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .main-stat .sub {
      font-size: 18px;
      color: rgba(255,255,255,0.9);
      margin-top: 8px;
    }
    .main-stat .live {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #4ade80;
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 20px;
      animation: slideUp 0.7s ease-out;
    }
    .card.wide {
      grid-column: span 2;
      display: flex;
      flex-direction: column;
    }
    .card h2 {
      font-size: 12px;
      font-weight: 500;
      color: #bbb;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card h2::before {
      content: '';
      width: 4px;
      height: 4px;
      background: #667eea;
      border-radius: 50%;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 600;
      background: linear-gradient(135deg, #a5b4fc, #c4b5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .stat-sub {
      font-size: 13px;
      color: #666;
      margin-top: 4px;
    }
    .chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      height: 160px;
      gap: 8px;
      margin-top: auto;
    }
    .chart-bar {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .chart-bar .bar {
      width: 100%;
      max-width: 50px;
      background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px 8px 4px 4px;
      min-height: 8px;
      transition: height 0.5s ease;
      position: relative;
    }
    .chart-bar .bar:hover {
      filter: brightness(1.2);
    }
    .chart-bar .bar-val {
      font-size: 11px;
      font-weight: 600;
      color: #ddd;
    }
    .chart-bar .bar-date {
      font-size: 11px;
      color: #aaa;
    }
    .chart-bar.today .bar {
      background: linear-gradient(180deg, #4ade80 0%, #22c55e 100%);
      box-shadow: 0 4px 20px rgba(74, 222, 128, 0.3);
    }
    .chart-bar.today .bar-date {
      color: #4ade80;
      font-weight: 600;
    }
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .file-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: rgba(255,255,255,0.03);
      border-radius: 12px;
      transition: all 0.2s;
      cursor: pointer;
    }
    .file-item:hover {
      background: rgba(255,255,255,0.08);
      transform: translateX(4px);
    }
    .file-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .file-info {
      flex: 1;
      min-width: 0;
    }
    .file-name {
      font-weight: 500;
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-path {
      font-size: 11px;
      color: #666;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-stats {
      text-align: right;
    }
    .file-cost {
      font-weight: 600;
      font-size: 16px;
      background: linear-gradient(135deg, #a5b4fc, #c4b5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .file-time {
      font-size: 12px;
      color: #666;
    }
    .empty {
      text-align: center;
      padding: 40px;
      color: #666;
    }
    .empty-icon {
      margin-bottom: 12px;
      opacity: 0.5;
    }
    .heatmap-container {
      margin-top: 24px;
      animation: slideUp 0.8s ease-out;
      overflow: visible;
    }
    .heatmap-wrapper {
      display: flex;
      justify-content: center;
      gap: 8px;
      overflow: visible;
      padding: 0 60px;
    }
    .heatmap-days {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 32px 0 8px 0;
      font-size: 11px;
      color: #888;
    }
    .heatmap-days div {
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 4px;
    }
    .heatmap {
      display: flex;
      gap: 3px;
      overflow: visible;
      padding: 32px 0 8px 0;
    }
    .heatmap-week {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .heatmap-day {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      transition: all 0.2s;
      cursor: pointer;
      position: relative;
    }
    .heatmap-day:hover {
      transform: scale(1.3);
      box-shadow: 0 0 8px rgba(102, 126, 234, 0.5);
      z-index: 10000;
    }
    .heatmap-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11px;
      color: #666;
    }
    .heatmap-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      justify-content: center;
    }
    .heatmap-legend span {
      font-size: 11px;
      color: #666;
    }
    .heatmap-legend-colors {
      display: flex;
      gap: 3px;
    }
    .heatmap-legend-colors div {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }
    .donut-container {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 32px;
      padding: 20px 0;
    }
    .donut-chart {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .donut-chart svg {
      transform: rotate(-90deg);
    }
    .donut-total {
      text-align: center;
      margin-top: 16px;
    }
    .donut-total .amount {
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(135deg, #a5b4fc, #c4b5fd);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .donut-total .label {
      font-size: 12px;
      color: #888;
      margin-top: 4px;
    }
    .donut-legend {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .donut-legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .donut-legend-color {
      width: 14px;
      height: 14px;
      border-radius: 4px;
    }
    .donut-legend-ext {
      font-weight: 600;
      font-size: 13px;
      min-width: 60px;
    }
    .donut-legend-cost {
      font-size: 13px;
      color: #c4b5fd;
    }
    .donut-legend-percent {
      font-size: 12px;
      color: #666;
      min-width: 45px;
      text-align: right;
    }
    .tooltip {
      position: relative;
    }
    .tooltip::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #1a1a2e;
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
      z-index: 9999;
    }
    .tooltip:hover::after {
      opacity: 1;
    }

    /* 반응형 디자인 */
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }
      .card.wide {
        grid-column: span 2;
      }
      .donut-container {
        flex-direction: column;
        gap: 24px;
      }
    }

    @media (max-width: 600px) {
      body {
        padding: 16px;
      }
      .header h1 {
        font-size: 32px;
      }
      .main-stat {
        padding: 24px 16px;
      }
      .main-stat .value {
        font-size: 32px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .card.wide {
        grid-column: span 1;
      }
      .stat-value {
        font-size: 24px;
      }
      .heatmap-wrapper {
        padding: 0 20px;
        overflow-x: auto;
      }
      .heatmap-days div {
        font-size: 9px;
      }
      .heatmap-day {
        width: 10px;
        height: 10px;
      }
      .donut-legend {
        gap: 6px;
      }
      .donut-legend-item {
        font-size: 11px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="subtitle">Developer Productivity</div>
    <h1>WorthyCode</h1>
    <div class="date">${todayDate}</div>
  </div>

  <div class="main-stat">
    <div class="label">Today's Earnings</div>
    <div class="value">${formatCost(today.totalCost)}</div>
    <div class="sub"><span class="live"></span>${formatTime(today.totalTimeMs)} worked</div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Hourly Rate</h2>
      <div class="stat-value">${formatCost(config.hourlyRate)}</div>
      <div class="stat-sub">per hour</div>
    </div>
    <div class="card">
      <h2>Week Total</h2>
      <div class="stat-value">${formatCost(weekTotal)}</div>
      <div class="stat-sub">last 7 days</div>
    </div>
    <div class="card">
      <h2>Files Today</h2>
      <div class="stat-value">${Object.keys(today.files).length}</div>
      <div class="stat-sub">files edited</div>
    </div>
  </div>

  <div class="grid">
    <div class="card wide">
      <h2>Weekly Overview</h2>
      <div class="chart">
        ${history.reverse().map((h, i) => {
          const isToday = i === history.length - 1;
          return `
          <div class="chart-bar ${isToday ? 'today' : ''}">
            <div class="bar-val">${formatCost(h.cost)}</div>
            <div class="bar" style="height: ${Math.max(8, (h.cost / maxCost) * 100)}px;"></div>
            <div class="bar-date">${isToday ? 'Today' : h.date.slice(5)}</div>
          </div>
        `}).join('')}
      </div>
    </div>
    <div class="card">
      <h2>TOP 5 FILES</h2>
      ${files.length === 0 ? `
        <div class="empty">
          <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg></div>
          <div>No files yet</div>
        </div>
      ` : `
        <div class="file-list">
          ${files.slice(0, 5).map((f) => `
            <div class="file-item" data-path="${f.path}" onclick="openFile(this)">
              <div class="file-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
              <div class="file-info">
                <div class="file-name">${f.name}</div>
                <div class="file-path">${f.path}</div>
              </div>
              <div class="file-stats">
                <div class="file-cost">${formatCost(f.cost)}</div>
                <div class="file-time">${formatTime(f.time)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  </div>

  <div class="card" style="margin-bottom: 24px;">
    <h2>TOP 10 FILE TYPES</h2>
    ${extData.length === 0 ? `
      <div class="empty">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></div>
        <div>No data yet</div>
      </div>
    ` : `
      <div class="donut-container">
        <div class="donut-chart">
          <svg width="160" height="160" viewBox="0 0 160 160">
            ${donutSegments.map(seg => {
              const radius = 60;
              const circumference = 2 * Math.PI * radius;
              const strokeDasharray = `${(seg.percent / 100) * circumference} ${circumference}`;
              const strokeDashoffset = -((seg.startPercent / 100) * circumference);
              return `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${seg.color}" stroke-width="24" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}" />`;
            }).join('')}
          </svg>
          <div class="donut-total">
            <div class="amount">${formatCost(totalExtCost)}</div>
            <div class="label">Total</div>
          </div>
        </div>
        <div class="donut-legend">
          ${donutSegments.map(seg => `
            <div class="donut-legend-item">
              <div class="donut-legend-color" style="background: ${seg.color};"></div>
              <div class="donut-legend-ext">${seg.ext}</div>
              <div class="donut-legend-cost">${formatCost(seg.cost)}</div>
              <div class="donut-legend-percent">${seg.percent.toFixed(1)}%</div>
            </div>
          `).join('')}
        </div>
      </div>
    `}
  </div>

  <div class="card heatmap-container">
    <h2>ACTIVITY</h2>
    <div class="heatmap-wrapper">
      <div class="heatmap-days">
        <div>S</div>
        <div>M</div>
        <div>T</div>
        <div>W</div>
        <div>T</div>
        <div>F</div>
        <div>S</div>
      </div>
      <div class="heatmap">
        ${weeks.map(week => `
          <div class="heatmap-week">
            ${week.map(day => `
              <div class="heatmap-day tooltip"
                   style="background: ${getHeatmapColor(day.cost)};"
                   data-tooltip="${day.date}: ${formatCost(day.cost)}">
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="heatmap-legend">
      <span>Less</span>
      <div class="heatmap-legend-colors">
        <div style="background: rgba(255,255,255,0.08);"></div>
        <div style="background: #3b5998;"></div>
        <div style="background: #5b7bc0;"></div>
        <div style="background: #7b9bd8;"></div>
        <div style="background: #a5b4fc;"></div>
      </div>
      <span>More</span>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function openFile(element) {
      const path = element.getAttribute('data-path');
      if (path) {
        vscode.postMessage({ command: 'openFile', path: path });
      }
    }
  </script>
</body>
</html>`;
  }

  async showHistory() {
    const history = this.getHistory();
    const config = this.getConfig();

    const dates = Object.keys(history)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 7);

    if (dates.length === 0) {
      vscode.window.showInformationMessage('No history yet.');
      return;
    }

    const lines = [`Last 7 Days`, ``];

    let weekTotal = 0;
    dates.forEach(date => {
      const dayData = history[date];
      const timeStr = this.formatTime(dayData.totalTimeMs);
      const costStr = this.formatCost(dayData.totalCost, config.currency);
      const isToday = date === this.getToday() ? ' (today)' : '';
      lines.push(`${date}${isToday}: ${timeStr} - ${costStr}`);
      weekTotal += dayData.totalCost;
    });

    lines.push(``, `Week total: ${this.formatCost(weekTotal, config.currency)}`);

    vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
  }

  async setHourlyRate() {
    const config = this.getConfig();
    const input = await vscode.window.showInputBox({
      prompt: 'Set hourly rate',
      value: config.hourlyRate.toString(),
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1 || num > 10000000) {
          return 'Please enter a number between 1 and 10,000,000';
        }
        return null;
      }
    });

    if (input !== undefined) {
      const rate = parseInt(input);
      await vscode.workspace.getConfiguration('worthycode').update(
        'hourlyRate',
        rate,
        vscode.ConfigurationTarget.Global
      );
      this.updateStatusBar();
      const rateStr = this.formatCost(rate, config.currency);
      vscode.window.showInformationMessage(`Hourly rate set to ${rateStr}/h`);
    }
  }

  async resetToday() {
    const confirm = await vscode.window.showWarningMessage(
      'Reset today\'s record?',
      { modal: true },
      'Reset'
    );

    if (confirm === 'Reset') {
      await this.saveTodayData({
        date: this.getToday(),
        totalTimeMs: 0,
        totalCost: 0,
        files: {}
      });
      this.updateStatusBar();
      vscode.window.showInformationMessage('Today\'s record has been reset.');
    }
  }

  toggleTracking() {
    if (this.isTracking) {
      this.pauseTracking();
      vscode.window.showInformationMessage('WorthyCode: Tracking paused');
    } else {
      this.startTracking();
      this.resetIdleTimer();
      vscode.window.showInformationMessage('WorthyCode: Tracking started');
    }
  }

  dispose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.statusBarItem.dispose();
  }
}

// TreeView Items
class SettingItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly value: string,
    public readonly commandId: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.command = {
      command: commandId,
      title: label
    };
    this.iconPath = new vscode.ThemeIcon('settings-gear');
  }
}

class StatsItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly value: string,
    icon: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

// Settings TreeView Provider
class SettingsProvider implements vscode.TreeDataProvider<SettingItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SettingItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SettingItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SettingItem[] {
    const config = vscode.workspace.getConfiguration('worthycode');
    const hourlyRate = config.get<number>('hourlyRate', 30000);
    const idleTimeout = config.get<number>('idleTimeout', 60);
    const currency = config.get<string>('currency', '$');

    return [
      new SettingItem('Hourly Rate', `${currency}${hourlyRate.toLocaleString()}/h`, 'worthycode.setHourlyRate'),
      new SettingItem('Idle Timeout', `${idleTimeout}s`, 'worthycode.setIdleTimeout'),
      new SettingItem('Currency', currency, 'worthycode.setCurrency')
    ];
  }
}

// Stats TreeView Provider
class StatsProvider implements vscode.TreeDataProvider<StatsItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StatsItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: StatsItem): vscode.TreeItem {
    return element;
  }

  getChildren(): StatsItem[] {
    const config = vscode.workspace.getConfiguration('worthycode');
    const currency = config.get<string>('currency', '$');
    const hourlyRate = config.get<number>('hourlyRate', 30000);

    const history = this.context.globalState.get<HistoryData>('history', {});
    const today = new Date().toISOString().split('T')[0];
    const data = history[today] || { totalTimeMs: 0, totalCost: 0, files: {} };

    const totalSeconds = Math.floor(data.totalTimeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    const fileCount = Object.keys(data.files).length;

    return [
      new StatsItem('Work Time', timeStr, 'clock'),
      new StatsItem('Earned', `${currency}${data.totalCost.toLocaleString()}`, 'credit-card'),
      new StatsItem('Files', `${fileCount} files`, 'file'),
      new StatsItem('Hourly Rate', `${currency}${hourlyRate.toLocaleString()}/h`, 'settings-gear')
    ];
  }
}

let tracker: TimeTracker | null = null;
let settingsProvider: SettingsProvider | null = null;
let statsProvider: StatsProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('WorthyCode activated');

  tracker = new TimeTracker(context);

  // TreeView 등록
  settingsProvider = new SettingsProvider();
  statsProvider = new StatsProvider(context);

  vscode.window.registerTreeDataProvider('worthycode.settings', settingsProvider);
  vscode.window.registerTreeDataProvider('worthycode.stats', statsProvider);

  // 1초마다 Stats 갱신
  const statsRefreshTimer = setInterval(() => {
    statsProvider?.refresh();
  }, 1000);

  const textChangeListener = vscode.workspace.onDidChangeTextDocument(
    debounce(() => tracker?.onUserActivity(), 300)
  );

  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(() => {
    tracker?.onUserActivity();
  });

  const selectionChangeListener = vscode.window.onDidChangeTextEditorSelection(
    debounce(() => tracker?.onUserActivity(), 300)
  );

  const showStatsCmd = vscode.commands.registerCommand('worthycode.showStats', () => {
    tracker?.showStats();
  });

  const showFileStatsCmd = vscode.commands.registerCommand('worthycode.showFileStats', () => {
    tracker?.showFileStats();
  });

  const showHistoryCmd = vscode.commands.registerCommand('worthycode.showHistory', () => {
    tracker?.showHistory();
  });

  const showDashboardCmd = vscode.commands.registerCommand('worthycode.showDashboard', () => {
    tracker?.showDashboard();
  });

  const setHourlyRateCmd = vscode.commands.registerCommand('worthycode.setHourlyRate', async () => {
    await tracker?.setHourlyRate();
    settingsProvider?.refresh();
  });

  const setIdleTimeoutCmd = vscode.commands.registerCommand('worthycode.setIdleTimeout', async () => {
    const config = vscode.workspace.getConfiguration('worthycode');
    const current = config.get<number>('idleTimeout', 60);
    const input = await vscode.window.showInputBox({
      prompt: 'Set idle timeout (seconds)',
      value: current.toString(),
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1 || num > 600) {
          return 'Please enter a number between 1 and 600';
        }
        return null;
      }
    });
    if (input !== undefined) {
      await config.update('idleTimeout', parseInt(input), vscode.ConfigurationTarget.Global);
      settingsProvider?.refresh();
      vscode.window.showInformationMessage(`Idle timeout set to ${input}s`);
    }
  });

  const setCurrencyCmd = vscode.commands.registerCommand('worthycode.setCurrency', async () => {
    const config = vscode.workspace.getConfiguration('worthycode');
    const currencies = [
      { label: '$ (USD)', value: '$' },
      { label: '₩ (KRW)', value: '₩' },
      { label: '€ (EUR)', value: '€' },
      { label: '£ (GBP)', value: '£' },
      { label: '¥ (JPY)', value: '¥' },
      { label: '¥ (CNY)', value: '¥' }
    ];
    const selected = await vscode.window.showQuickPick(currencies, {
      placeHolder: 'Select currency'
    });
    if (selected) {
      await config.update('currency', selected.value, vscode.ConfigurationTarget.Global);
      settingsProvider?.refresh();
      statsProvider?.refresh();
      vscode.window.showInformationMessage(`Currency set to ${selected.value}`);
    }
  });

  const resetTodayCmd = vscode.commands.registerCommand('worthycode.resetToday', () => {
    tracker?.resetToday();
  });

  const toggleTrackingCmd = vscode.commands.registerCommand('worthycode.toggleTracking', () => {
    tracker?.toggleTracking();
  });

  context.subscriptions.push(
    textChangeListener,
    editorChangeListener,
    selectionChangeListener,
    showStatsCmd,
    showFileStatsCmd,
    showHistoryCmd,
    showDashboardCmd,
    setHourlyRateCmd,
    setIdleTimeoutCmd,
    setCurrencyCmd,
    resetTodayCmd,
    toggleTrackingCmd,
    { dispose: () => {
      tracker?.dispose();
      clearInterval(statsRefreshTimer);
    }}
  );
}

export function deactivate() {
  tracker?.dispose();
  tracker = null;
}

function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func(...args), wait);
  };
}
