import fs from 'fs';
import path from 'path';

export class BacktestParser {
  parse(backtestId: string): any {
    const resultsDir = path.join(process.cwd(), 'user_data', 'backtest_results');
    try {
      const targetFile = `backtest-result-${backtestId}.json`;
      const content = fs.readFileSync(path.join(resultsDir, targetFile), 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      console.error('Error parsing backtest results:', e);
      return null;
    }
  }
}
