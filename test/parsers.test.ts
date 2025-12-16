// Parser tests for aimem

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { javascriptParser } from '../src/indexer/parsers/javascript.js';
import { pythonParser } from '../src/indexer/parsers/python.js';
import { getLineNumber, extractLines } from '../src/indexer/parsers/base.js';

describe('Parser Helpers', () => {
  describe('getLineNumber', () => {
    it('should return line 1 for position 0', () => {
      const content = 'first line\nsecond line';
      assert.strictEqual(getLineNumber(content, 0), 1);
    });

    it('should return correct line for mid-file position', () => {
      const content = 'line 1\nline 2\nline 3';
      // Position after first newline (in "line 2")
      const pos = content.indexOf('line 2');
      assert.strictEqual(getLineNumber(content, pos), 2);
    });

    it('should handle last line', () => {
      const content = 'line 1\nline 2\nline 3';
      const pos = content.indexOf('line 3');
      assert.strictEqual(getLineNumber(content, pos), 3);
    });
  });

  describe('extractLines', () => {
    it('should extract single line', () => {
      const content = 'line 1\nline 2\nline 3';
      assert.strictEqual(extractLines(content, 2, 2), 'line 2');
    });

    it('should extract multiple lines', () => {
      const content = 'line 1\nline 2\nline 3\nline 4';
      assert.strictEqual(extractLines(content, 2, 3), 'line 2\nline 3');
    });

    it('should handle first line', () => {
      const content = 'first\nsecond\nthird';
      assert.strictEqual(extractLines(content, 1, 1), 'first');
    });
  });
});

describe('JavaScript Parser', () => {
  it('should have correct extensions', () => {
    assert.deepStrictEqual(
      javascriptParser.extensions,
      ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
    );
  });

  describe('Functions', () => {
    it('should parse regular function declaration', () => {
      const code = `function greet(name) {
  return 'Hello, ' + name;
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].type, 'function');
      assert.strictEqual(structures[0].name, 'greet');
      assert.strictEqual(structures[0].signature, 'function greet(name)');
      assert.strictEqual(structures[0].lineStart, 1);
      assert.strictEqual(structures[0].lineEnd, 3);
    });

    it('should parse async function', () => {
      const code = `async function fetchData(url) {
  const response = await fetch(url);
  return response.json();
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].name, 'fetchData');
      assert.ok(structures[0].signature?.includes('fetchData'));
    });

    it('should parse exported function', () => {
      const code = `export function calculate(a, b) {
  return a + b;
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].name, 'calculate');
    });

    it('should parse multiple functions', () => {
      const code = `function first() {
  return 1;
}

function second() {
  return 2;
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 2);
      assert.strictEqual(structures[0].name, 'first');
      assert.strictEqual(structures[1].name, 'second');
    });
  });

  describe('Arrow Functions', () => {
    it('should parse const arrow function', () => {
      const code = `const multiply = (a, b) => {
  return a * b;
};`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].type, 'function');
      assert.strictEqual(structures[0].name, 'multiply');
      assert.ok((structures[0].metadata as any).arrow);
    });

    it('should parse exported arrow function', () => {
      const code = `export const handler = async () => {
  return 'handled';
};`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].name, 'handler');
    });
  });

  describe('Classes', () => {
    it('should parse class declaration', () => {
      const code = `class User {
  constructor(name) {
    this.name = name;
  }
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.ok(structures.some(s => s.type === 'class' && s.name === 'User'));
    });

    it('should parse class with extends', () => {
      const code = `class Admin extends User {
  constructor(name, role) {
    super(name);
    this.role = role;
  }
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      const classStructure = structures.find(s => s.type === 'class');
      assert.ok(classStructure);
      assert.strictEqual(classStructure.name, 'Admin');
      assert.ok(classStructure.signature?.includes('extends'));
    });

    it('should parse exported class', () => {
      const code = `export class Service {
  run() {}
}`;
      const structures = javascriptParser.parse(code, 'test.js');

      assert.ok(structures.some(s => s.type === 'class' && s.name === 'Service'));
    });
  });

  describe('Interfaces (TypeScript)', () => {
    it('should parse interface declaration', () => {
      const code = `interface Config {
  host: string;
  port: number;
}`;
      const structures = javascriptParser.parse(code, 'test.ts');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].type, 'interface');
      assert.strictEqual(structures[0].name, 'Config');
    });

    it('should parse exported interface', () => {
      const code = `export interface Options {
  debug: boolean;
}`;
      const structures = javascriptParser.parse(code, 'test.ts');

      assert.strictEqual(structures[0].name, 'Options');
    });

    it('should parse interface with extends', () => {
      const code = `interface ExtendedConfig extends Config {
  timeout: number;
}`;
      const structures = javascriptParser.parse(code, 'test.ts');

      assert.ok(structures[0].signature?.includes('extends'));
    });
  });

  describe('Type Aliases (TypeScript)', () => {
    it('should parse type alias', () => {
      const code = `type ID = string | number;`;
      const structures = javascriptParser.parse(code, 'test.ts');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].type, 'type');
      assert.strictEqual(structures[0].name, 'ID');
    });

    it('should parse complex type', () => {
      const code = `type Handler<T> = (event: T) => void;`;
      const structures = javascriptParser.parse(code, 'test.ts');

      assert.strictEqual(structures[0].name, 'Handler');
    });
  });

  describe('Complex Files', () => {
    it('should parse a file with mixed declarations', () => {
      const code = `
interface UserData {
  id: number;
  name: string;
}

type UserID = number;

export class UserService {
  private users: Map<number, UserData> = new Map();

  async getUser(id: UserID): Promise<UserData | null> {
    return this.users.get(id) || null;
  }
}

export function createUserService(): UserService {
  return new UserService();
}

const helper = () => {
  return 'helper';
};
`;
      const structures = javascriptParser.parse(code, 'user.ts');

      const types = structures.map(s => s.type);
      assert.ok(types.includes('interface'));
      assert.ok(types.includes('type'));
      assert.ok(types.includes('class'));
      assert.ok(types.includes('function'));
    });
  });
});

describe('Python Parser', () => {
  it('should have correct extensions', () => {
    assert.deepStrictEqual(pythonParser.extensions, ['.py', '.pyw']);
  });

  describe('Functions', () => {
    it('should parse function definition', () => {
      const code = `def greet(name):
    return f"Hello, {name}"`;
      const structures = pythonParser.parse(code, 'test.py');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].type, 'function');
      assert.strictEqual(structures[0].name, 'greet');
      assert.strictEqual(structures[0].signature, 'def greet(name)');
    });

    it('should parse async function', () => {
      const code = `async def fetch_data(url):
    response = await httpx.get(url)
    return response.json()`;
      const structures = pythonParser.parse(code, 'test.py');

      assert.strictEqual(structures.length, 1);
      assert.strictEqual(structures[0].name, 'fetch_data');
    });

    it('should parse function with type hints', () => {
      const code = `def calculate(a: int, b: int) -> int:
    return a + b`;
      const structures = pythonParser.parse(code, 'test.py');

      assert.strictEqual(structures[0].name, 'calculate');
    });

    it('should parse multiple functions', () => {
      const code = `def first():
    return 1

def second():
    return 2`;
      const structures = pythonParser.parse(code, 'test.py');

      assert.strictEqual(structures.length, 2);
      assert.strictEqual(structures[0].name, 'first');
      assert.strictEqual(structures[1].name, 'second');
    });
  });

  describe('Classes', () => {
    it('should parse class definition', () => {
      const code = `class User:
    def __init__(self, name):
        self.name = name`;
      const structures = pythonParser.parse(code, 'test.py');

      const classStructure = structures.find(s => s.type === 'class');
      assert.ok(classStructure);
      assert.strictEqual(classStructure.name, 'User');
    });

    it('should parse class with inheritance', () => {
      const code = `class Admin(User):
    def __init__(self, name, role):
        super().__init__(name)
        self.role = role`;
      const structures = pythonParser.parse(code, 'test.py');

      assert.ok(structures.some(s => s.type === 'class' && s.name === 'Admin'));
    });

    it('should parse methods inside class', () => {
      const code = `class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b`;
      const structures = pythonParser.parse(code, 'test.py');

      const methods = structures.filter(s => s.type === 'method');
      assert.strictEqual(methods.length, 2);
      assert.ok(methods.some(m => m.name === 'add'));
      assert.ok(methods.some(m => m.name === 'subtract'));
    });
  });

  describe('Complex Files', () => {
    it('should parse a file with mixed declarations', () => {
      const code = `def helper_function():
    return "helper"

class DataProcessor:
    def __init__(self):
        self.data = []

    def process(self, item):
        self.data.append(item)

def main():
    processor = DataProcessor()
    processor.process("item")
`;
      const structures = pythonParser.parse(code, 'processor.py');

      const functions = structures.filter(s => s.type === 'function');
      const classes = structures.filter(s => s.type === 'class');
      const methods = structures.filter(s => s.type === 'method');

      // Should find top-level functions (helper_function and main)
      assert.ok(functions.some(f => f.name === 'helper_function'), 'Should find helper_function');

      // Should find the class
      assert.ok(classes.some(c => c.name === 'DataProcessor'), 'Should find DataProcessor class');

      // Should find at least some methods
      assert.ok(methods.length >= 1, 'Should find at least one method');

      // Total structures should be reasonable
      assert.ok(structures.length >= 3, `Expected at least 3 structures, got ${structures.length}`);
    });
  });
});
