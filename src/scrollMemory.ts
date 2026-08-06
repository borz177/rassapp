// Экраны в этом SPA не перезагружаются между переходами, поэтому позицию скролла достаточно
// держать в памяти на время сеанса вкладки — sessionStorage/history.state тут не нужны.
const positions = new Map<string, number>();

export const saveScrollPosition = (key: string, value: number): void => {
  positions.set(key, value);
};

export const getScrollPosition = (key: string): number => positions.get(key) ?? 0;
