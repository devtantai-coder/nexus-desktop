import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { writeFileAtomic } from '../../util.ts'
import { runCommand } from '../../domain/runner.ts'
import type {
  BuildResult,
  DomainContext,
  DomainMatch,
  Platform,
  ProjectInput,
  ProjectResult,
  TestResult,
  ToolMetadata,
} from '../../domain/types.ts'
import { BaseDomainAdapter, defineTool } from '../base.ts'

const PYPROJECT = `[project]
name = "nexus-aiml-project"
version = "1.0.0"
description = "NEXUS AI/ML smoke project (PyTorch linear regression)"
requires-python = ">=3.10"
dependencies = ["torch>=2.0"]
`
const REQUIREMENTS = 'torch>=2.0\n'
const TRAIN_PY = `import torch


def make_dataset(samples: int = 64) -> tuple[torch.Tensor, torch.Tensor]:
    torch.manual_seed(42)
    x = torch.randn(samples, 4)
    weights = torch.tensor([1.5, -2.0, 0.5, 3.0])
    y = x @ weights + 0.1 * torch.randn(samples)
    return x, y


def train(epochs: int = 200, learning_rate: float = 0.2) -> dict:
    x, y = make_dataset()
    model = torch.nn.Linear(4, 1)
    optimizer = torch.optim.SGD(model.parameters(), lr=learning_rate)
    loss_fn = torch.nn.MSELoss()
    initial_loss = None
    final_loss = None
    for epoch in range(epochs):
        optimizer.zero_grad()
        prediction = model(x).squeeze(-1)
        loss = loss_fn(prediction, y)
        loss.backward()
        optimizer.step()
        if epoch == 0:
            initial_loss = float(loss.detach())
        final_loss = float(loss.detach())
    return {"initial_loss": initial_loss, "final_loss": final_loss, "epochs": epochs}


if __name__ == "__main__":
    result = train()
    print(f"initial_loss={result['initial_loss']:.4f} final_loss={result['final_loss']:.4f}")
`
const TEST_TRAIN_PY = `from train import make_dataset, train


def test_dataset_shapes() -> None:
    x, y = make_dataset(32)
    assert x.shape == (32, 4)
    assert y.shape == (32,)


def test_training_reduces_loss() -> None:
    result = train(epochs=150, learning_rate=0.2)
    assert result["final_loss"] < result["initial_loss"]
`
const README = `# NEXUS AI/ML project

PyTorch linear-regression smoke project. Training is real but tiny (CPU, seconds).

## Chạy

\`\`\`sh
python3 -m pytest -q   # chạy unit test + 1 vòng train thật
python3 train.py       # train và in initial_loss / final_loss
\`\`\`

Yêu cầu \`torch\` (xem requirements.txt). Không cài tự động — cài thủ công hoặc qua uv/pip sau khi bạn xác nhận.
`

export class AiMlDomain extends BaseDomainAdapter {
  readonly id = 'aiml'
  readonly label = 'AI & ML'
  readonly description =
    'Python, uv, PyTorch/transformers — detect ML project, build, test với train thật'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('python3', 'Python 3', 'aiml', 'python3', ['runtime', 'build', 'test', 'training'], {
      description:
        'Python runtime for ML projects; torch/transformers are imported by project code',
      installationGuide: 'Install Python >= 3.10 from python.org or your package manager',
      requiresRoot: true,
    }),
    defineTool('pip', 'pip', 'aiml', 'pip', ['package-manager'], {
      description: 'Python package installer',
      installationGuide: 'Bundled with most Python installs: python3 -m ensurepip',
    }),
    defineTool('uv', 'uv', 'aiml', 'uv', ['package-manager', 'env-manager'], {
      description: 'Fast Python package and project manager (astral.sh/uv)',
      installationGuide: 'Install from https://docs.astral.sh/uv/',
      installCommand: 'uv self update',
      healthCheck: 'uv --version',
    }),
    defineTool('pytest', 'pytest', 'aiml', 'pytest', ['test-runner'], {
      description: 'Python test runner used for ML smoke tests',
      installationGuide: 'python3 -m pip install --user pytest',
      installCommand: 'python3 -m pip install --user pytest',
    }),
    defineTool('jupyter', 'Jupyter', 'aiml', 'jupyter', ['notebook'], {
      description: 'Notebook environment for exploratory ML work',
      installationGuide: 'python3 -m pip install --user jupyter',
      installCommand: 'python3 -m pip install --user jupyter',
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    for (const file of ['pyproject.toml', 'requirements.txt', 'environment.yml', 'setup.py']) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    for (const file of ['train.py', 'model.py', 'predict.py']) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    try {
      if (readdirSync(root).some((entry) => entry.endsWith('.ipynb'))) reasons.push('notebooks')
    } catch {
      return reasons.length === 0
        ? []
        : [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.15), reasons }]
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.15), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['pyproject.toml', PYPROJECT],
      ['requirements.txt', REQUIREMENTS],
      ['train.py', TRAIN_PY],
      ['test_train.py', TEST_TRAIN_PY],
      ['README.md', README],
    ]
    for (const [relative, content] of files) {
      if (!writeFileAtomic(join(root, relative), content)) {
        return { ok: false, path: root, files: [], error: `Cannot write ${relative}` }
      }
    }
    return { ok: true, path: root, files: files.map(([relative]) => relative) }
  }

  override async build(_context: DomainContext, input: { path: string }): Promise<BuildResult> {
    const result = await runCommand(
      'python3 -m py_compile train.py test_train.py',
      input.path,
      120_000,
    )
    return { ...result, artifacts: result.ok ? ['train.py', 'test_train.py'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('python3 -m pytest -q', input.path, 300_000)
    return { ...result, passed: 0, failed: 0 }
  }
}
