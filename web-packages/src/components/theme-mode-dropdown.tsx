import { useThemeMode } from '../theme/theme-mode';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const THEME_ICONS = {
  system: '◐',
  light: '☀',
  dark: '☾',
} as const;

export default function ThemeModeDropdown() {
  const { themeMode, setThemeMode } = useThemeMode();
  const themeIcon = THEME_ICONS[themeMode];

  return (
    <label className="ui-theme-dropdown" aria-label="主题模式">
      <span className="ui-theme-dropdown-icon" aria-hidden="true">
        {themeIcon}
      </span>
      <select
        className="ui-select ui-theme-dropdown-select"
        value={themeMode}
        onChange={event => setThemeMode(event.target.value as 'system' | 'light' | 'dark')}
      >
        {THEME_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
