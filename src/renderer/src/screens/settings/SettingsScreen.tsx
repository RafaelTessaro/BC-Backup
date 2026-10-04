import { Cog, Info, Mail } from 'lucide-react'
import { ROUTES } from '@shared/routes'
import { Page, PageHeader } from '@renderer/components/shell/Page'
import { Segmented } from '@renderer/components/ui/Segmented'
import { navigate } from '@renderer/lib/router'
import { AboutTab } from './AboutTab'
import { EmailTab } from './EmailTab'
import { GeneralTab } from './GeneralTab'

type Tab = 'geral' | 'email' | 'sobre'

const TAB_ROUTE: Record<Tab, string> = {
  geral: ROUTES.settings,
  email: ROUTES.settingsEmail,
  sobre: ROUTES.settingsAbout
}

export function SettingsScreen({ tab }: { tab: Tab }) {
  return (
    <Page>
      <PageHeader title="Configurações" description="Preferências do aplicativo, e-mail e informações" />
      <Segmented<Tab>
        label="Seções das configurações"
        value={tab}
        onChange={(t) => navigate(TAB_ROUTE[t], { replace: true })}
        className="mb-6 w-[330px]"
        options={[
          { value: 'geral', label: 'Geral', icon: Cog },
          { value: 'email', label: 'E-mail', icon: Mail },
          { value: 'sobre', label: 'Sobre', icon: Info }
        ]}
      />
      <div key={tab} className="max-w-[760px] animate-fade-in">
        {tab === 'geral' && <GeneralTab />}
        {tab === 'email' && <EmailTab />}
        {tab === 'sobre' && <AboutTab />}
      </div>
    </Page>
  )
}
