import SectionHeader from '@/components/nav/SectionHeader';
import { StatusSection } from '@/tabs/StatusTab';
import { ChannelsSection } from '@/tabs/ChannelsTab';

/** Phone layout: Status and Channels on one screen, like WhatsApp's Updates tab. */
export default function UpdatesTab({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-col pb-4">
      <SectionHeader title="Updates" />
      <StatusSection compact />
      <hr className="my-2 border-wa-lightBorder dark:border-wa-darkBorder" />
      <ChannelsSection compact onCreate={onCreate} />
    </div>
  );
}
