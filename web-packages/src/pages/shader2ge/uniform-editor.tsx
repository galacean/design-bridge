import type { ParsedUniform, UniformValue } from '@galacean/shader2ge';

export type UniformChangeValue = UniformValue;

interface UniformEditorProps {
  uniforms: ParsedUniform[];
  overrides: Record<string, UniformValue>;
  onChange: (name: string, value: UniformChangeValue) => void;
}

export default function UniformEditor({ uniforms, overrides, onChange }: UniformEditorProps) {
  return (
    <section className="ui-card space-y-2">
      <span className="ui-kicker">Uniform 参数</span>
      <div className="space-y-2">
        {uniforms.map(uniform => (
          <UniformField key={uniform.name} uniform={uniform} value={overrides[uniform.name]} onChange={onChange} />
        ))}
      </div>
    </section>
  );
}

interface UniformFieldProps {
  uniform: ParsedUniform;
  value: UniformValue | undefined;
  onChange: (name: string, value: UniformChangeValue) => void;
}

function isVecValue(value: UniformValue | undefined): value is { x: number; y: number; z: number; w: number } {
  return typeof value === 'object' && value !== null && 'x' in value;
}

function UniformField({ uniform, value, onChange }: UniformFieldProps) {
  const label = uniform.comment ? `${uniform.name} (${uniform.comment})` : uniform.name;

  if (uniform.type === 'float' || uniform.type === 'int') {
    const numericValue = typeof value === 'number' ? value : 0;

    return (
      <div className="flex items-center gap-2">
        <label htmlFor={`shader-uniform-${uniform.name}`} className="text-[length:var(--text-caption)] text-[var(--color-text-secondary)] w-[140px] truncate" title={label}>
          {label}
        </label>
        <span className="ui-badge ui-badge-compact ui-badge-cyan">{uniform.type}</span>
        <input
          type="number"
          id={`shader-uniform-${uniform.name}`}
          step={uniform.type === 'int' ? 1 : 0.1}
          value={numericValue}
          onChange={event => onChange(uniform.name, Number(event.target.value))}
          className="ui-input flex-1 text-[length:var(--text-caption)] px-2"
        />
      </div>
    );
  }

  if (uniform.type === 'vec2' || uniform.type === 'vec3') {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[length:var(--text-caption)] text-[var(--color-text-secondary)] w-[140px] truncate" title={label}>
          {label}
        </label>
        <span className="ui-badge ui-badge-compact ui-badge-cyan">{uniform.type}</span>
        <span className="text-[length:var(--text-caption)] text-[var(--color-text-warning)]">请改用 vec4</span>
      </div>
    );
  }

  if (uniform.type === 'vec4') {
    const components = ['x', 'y', 'z', 'w'];
    const currentValue = isVecValue(value) ? value : { x: 0, y: 0, z: 0, w: 1 };

    return (
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label
            className="text-[length:var(--text-caption)] text-[var(--color-text-secondary)] w-[140px] truncate"
            title={label}
          >
            {label}
          </label>
          <span className="ui-badge ui-badge-compact ui-badge-cyan">{uniform.type}</span>
        </div>
        <div className="grid grid-cols-4 gap-1 sm:ml-[140px]">
          {components.map(component => (
            <div key={component} className="min-w-0 flex items-center gap-0.5">
              <span className="text-[9px] text-[var(--color-text-secondary)] uppercase">{component}</span>
              <input
                type="number"
                step={0.1}
                aria-label={`${uniform.name}.${component}`}
                value={currentValue[component as keyof typeof currentValue] ?? 0}
                onChange={event => {
                  const updated = { ...currentValue, [component]: Number(event.target.value) };

                  onChange(uniform.name, updated);
                }}
                className="ui-input w-full text-[length:var(--text-caption)] px-1.5"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (uniform.type === 'sampler2D') {
    const textureValue = typeof value === 'object' && value !== null && 'url' in value ? (value) : null;
    const currentUrl = textureValue?.url ?? '';

    return (
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label
            className="text-[length:var(--text-caption)] text-[var(--color-text-secondary)] w-[140px] truncate"
            title={label}
          >
            {label}
          </label>
          <span className="ui-badge ui-badge-compact ui-badge-cyan">sampler2D</span>
        </div>
        <div className="sm:ml-[140px]">
          <input
            type="text"
            value={currentUrl}
            aria-label={label}
            placeholder="输入图片链接 URL"
            onChange={event => {
              const url = event.target.value;

              onChange(uniform.name, {
                url,
                wrapS: 10497,
                wrapT: 10497,
                magFilter: 9729,
                minFilter: 9729,
                flipY: true,
              });
            }}
            className="ui-input w-full text-[length:var(--text-caption)] px-2"
          />
        </div>
      </div>
    );
  }

  return null;
}
