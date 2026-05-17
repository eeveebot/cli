declare module 'ascii-table' {
  const AsciiTable: {
    new (): AsciiTableInstance;
    LEFT: 0;
    RIGHT: 2;
  };

  interface AsciiTableInstance {
    setHeading(...columns: string[]): AsciiTableInstance;
    addRow(...columns: string[]): AsciiTableInstance;
    setAlign(column: number, direction: number): AsciiTableInstance;
    removeBorder(): AsciiTableInstance;
    setBorder(
      horizontal?: string,
      vertical?: string,
      corner?: string,
    ): AsciiTableInstance;
    toString(): string;
  }

  export = AsciiTable;
}
