import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useAppearance, type ColorScheme, type Theme } from '~/state/appearance';

const schemes = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;
const themes = [
  { value: 'darcula', label: 'Darcula' },
  { value: 'monaco', label: 'Monaco' },
] as const;

function SchemePreview({ scheme }: { scheme: ColorScheme }) {
  return (
    <span
      className={`relative block aspect-[1.85] overflow-hidden rounded-[7px] border border-[#e4e4e7] bg-white ${
        scheme === 'dark'
          ? 'hue-rotate-180 invert-[0.94]'
          : scheme === 'system'
            ? "after:absolute after:inset-y-0 after:right-0 after:left-1/2 after:backdrop-hue-rotate-180 after:backdrop-invert-[0.94] after:content-['']"
            : ''
      }`}
      aria-hidden="true"
    >
      <span className="absolute inset-y-0 left-0 w-[22%] border-r border-[#dedee1] bg-[#fafafa] px-[7px] py-2.5">
        <i className="mb-2.5 block h-[9px] rounded-lg border border-[#dedee1] bg-white" />
        <i className="mb-[5px] block h-[7px] rounded-lg bg-[#ebebee]" />
        <i className="mb-[5px] block h-[7px] rounded-lg bg-[#ebebee]" />
        <i className="mb-[5px] block h-[7px] rounded-lg bg-[#ebebee]" />
      </span>
      <span className="absolute top-[30%] left-[27%] w-[33%]">
        <i className="mb-3 ml-[60%] block h-2.5 w-[65%] rounded-lg bg-[#dedee1]" />
        <i className="mb-1.5 block h-[7px] rounded-lg bg-[#dedee1]" />
        <i className="mb-1.5 block h-[7px] w-3/4 rounded-lg bg-[#dedee1]" />
      </span>
      <span className="absolute top-[8%] right-[5%] h-[48%] w-[21%] rounded-[7px] border border-[#ddd] bg-white px-[7px] py-2.5 shadow-[0_2px_4px_#0002]">
        <i className="mb-[9px] block h-[3px] rounded-lg border-l-[3px] border-[#85cbb0] bg-[#dedee1]" />
        <i className="mb-[9px] block h-[3px] rounded-lg border-l-[3px] border-[#a69bdb] bg-[#dedee1]" />
        <i className="mb-[9px] block h-[3px] rounded-lg border-l-[3px] border-[#e0bc61] bg-[#dedee1]" />
      </span>
      <span className="absolute right-[6%] bottom-[8%] left-[27%] flex h-[16%] items-center justify-between rounded-[5px] border border-[#ddd] bg-white p-[5px]">
        <i className="block h-1 w-[36%] rounded-lg bg-[#dedee1]" />
        <b className="size-2.5 rounded-full bg-[#817bfa]" />
      </span>
    </span>
  );
}

export default function SettingsPage() {
  const appearance = useAppearance();
  const chooseTheme = (scheme: 'light' | 'dark', theme: Theme) =>
    useAppearance.setState(scheme === 'light' ? { lightTheme: theme } : { darkTheme: theme });
  return (
    <>
      <h1 className="mt-0 mb-2 text-2xl leading-8 font-semibold tracking-[-0.6px]">Appearance</h1>
      <fieldset className="m-0 mt-8 min-w-0 border-0 p-0">
        <legend className="mb-4 p-0 text-base leading-6 font-semibold">Color scheme</legend>
        <div className="grid grid-cols-3 gap-3 max-[600px]:gap-2">
          {schemes.map(({ value, label, Icon }) => (
            <label
              className="group relative cursor-pointer rounded-xl border border-border p-2 hover:border-input has-checked:border-primary has-checked:shadow-[0_0_0_1px_var(--primary)] has-checked:hover:border-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring max-[600px]:p-[5px]"
              key={value}
            >
              <input
                className="sr-only"
                type="radio"
                name="color-scheme"
                value={value}
                checked={appearance.colorScheme === value}
                onChange={() => useAppearance.setState({ colorScheme: value })}
              />
              <SchemePreview scheme={value} />
              <span className="flex items-center justify-center gap-1.5 pt-1.5 text-xs leading-5 text-muted-foreground group-has-checked:text-foreground">
                <Icon size={14} />
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <section className="mt-8 min-w-0" aria-labelledby="themes-heading">
        <h2 className="mt-0 mb-1.5 text-base leading-6 font-semibold" id="themes-heading">
          Themes
        </h2>
        <p className="mt-0 mb-6 text-muted-foreground">
          Choose syntax highlighting for each color scheme.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {themes.map(({ value, label }) => (
            <div
              className="rounded-xl border border-border px-4 pt-5 pb-3 hover:border-input max-[600px]:px-2"
              key={value}
            >
              <div className="flex justify-center gap-7 max-[600px]:gap-5">
                {(['light', 'dark'] as const).map((scheme) => {
                  const selected =
                    appearance[scheme === 'light' ? 'lightTheme' : 'darkTheme'] === value;
                  const Icon = scheme === 'light' ? Sun : Moon;
                  return (
                    <label
                      className="relative flex cursor-pointer flex-col items-center gap-2.5 text-xs leading-5 text-muted-foreground"
                      key={scheme}
                    >
                      <input
                        className="peer sr-only"
                        type="radio"
                        name={`${scheme}-theme`}
                        aria-label={`${label} ${scheme}`}
                        checked={selected}
                        onChange={() => chooseTheme(scheme, value)}
                      />
                      <span
                        className="appearance-palette relative flex size-14 items-center justify-center rounded-full border-2 border-card text-foreground shadow-[0_0_0_1px_var(--border)] [background:radial-gradient(circle_at_28%_22%,var(--card),transparent_65%),linear-gradient(135deg,var(--primary),var(--background)_70%)] peer-checked:outline-2 peer-checked:outline-offset-3 peer-checked:outline-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring max-[600px]:size-[46px]"
                        data-theme={value}
                        data-color-scheme={scheme}
                        aria-hidden="true"
                      >
                        {selected && <Check size={20} />}
                        <span className="absolute -right-[5px] -bottom-[3px] flex size-5 items-center justify-center rounded-full border border-border bg-card">
                          <Icon size={12} />
                        </span>
                      </span>
                      <span>{scheme === 'light' ? 'Light' : 'Dark'}</span>
                    </label>
                  );
                })}
              </div>
              <h3 className="mt-[18px] mb-0 text-sm font-medium">{label}</h3>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
