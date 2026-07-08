import type { SvgIconComponent } from '@mui/icons-material'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import PanoramaOutlinedIcon from '@mui/icons-material/PanoramaOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined'
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import ElectricalServicesOutlinedIcon from '@mui/icons-material/ElectricalServicesOutlined'
import MusicNoteOutlinedIcon from '@mui/icons-material/MusicNoteOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import CelebrationOutlinedIcon from '@mui/icons-material/CelebrationOutlined'
import LooksOneOutlinedIcon from '@mui/icons-material/LooksOneOutlined'
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined'
import DirectionsBusOutlinedIcon from '@mui/icons-material/DirectionsBusOutlined'
import LocationCityOutlinedIcon from '@mui/icons-material/LocationCityOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined'
import CheckroomOutlinedIcon from '@mui/icons-material/CheckroomOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import PointOfSaleOutlinedIcon from '@mui/icons-material/PointOfSaleOutlined'
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined'
import TrendingDownOutlinedIcon from '@mui/icons-material/TrendingDownOutlined'
import WavingHandOutlinedIcon from '@mui/icons-material/WavingHandOutlined'
import CakeOutlinedIcon from '@mui/icons-material/CakeOutlined'
import MilitaryTechOutlinedIcon from '@mui/icons-material/MilitaryTechOutlined'
import LibraryMusicOutlinedIcon from '@mui/icons-material/LibraryMusicOutlined'
import QueueMusicOutlinedIcon from '@mui/icons-material/QueueMusicOutlined'
import ContactsOutlinedIcon from '@mui/icons-material/ContactsOutlined'
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import type { AchievementCategory, AchievementKey } from '../../types/entities.ts'

export const ACHIEVEMENT_KEY_ICONS: Partial<Record<AchievementKey, SvgIconComponent>> = {
  logo_a_go_go: ImageOutlinedIcon,
  now_were_photogenic: PhotoCameraOutlinedIcon,
  big_banner_energy: PanoramaOutlinedIcon,
  proper_band_honestly: BadgeOutlinedIcon,
  three_chords_three_humans: GroupsOutlinedIcon,
  the_dep_list_deepens: GroupAddOutlinedIcon,
  bring_your_own_bassist: PersonAddAlt1OutlinedIcon,
  fully_plugged_in: ElectricalServicesOutlinedIcon,
  first_rehearsal_last_excuse: MusicNoteOutlinedIcon,
  calendar_rock: EventOutlinedIcon,
  this_ones_actually_happening: CelebrationOutlinedIcon,
  ten_gigs_no_cry: LooksOneOutlinedIcon,
  fifty_shades_of_soundcheck: LocalFireDepartmentOutlinedIcon,
  tour_bus_not_included: DirectionsBusOutlinedIcon,
  five_city_shuffle: LocationCityOutlinedIcon,
  the_van_has_opinions: MapOutlinedIcon,
  international_noise_complaint: PublicOutlinedIcon,
  please_pay_the_piper: ReceiptLongOutlinedIcon,
  gear_acquisition_syndrome: ShoppingCartOutlinedIcon,
  shirts_before_hits: CheckroomOutlinedIcon,
  box_set_behavior: Inventory2OutlinedIcon,
  cash_from_the_merch_pit: PointOfSaleOutlinedIcon,
  black_ink_sabbath: TrendingUpOutlinedIcon,
  the_blues_ledger: TrendingDownOutlinedIcon,
  welcome_to_the_giggle: WavingHandOutlinedIcon,
  one_month_still_tuning: CakeOutlinedIcon,
  still_standing_still_loud: MilitaryTechOutlinedIcon,
  five_songs_and_a_prayer: LibraryMusicOutlinedIcon,
  setlist_match_fire: QueueMusicOutlinedIcon,
  fifty_people_who_might_answer: ContactsOutlinedIcon,
}

export const ACHIEVEMENT_CATEGORY_ICONS: Record<AchievementCategory, SvgIconComponent> = {
  profile: BadgeOutlinedIcon,
  gigs: EventOutlinedIcon,
  invoices: ReceiptLongOutlinedIcon,
  purchase: ShoppingCartOutlinedIcon,
  merchandise: CheckroomOutlinedIcon,
  finance: TrendingUpOutlinedIcon,
  platform: EmojiEventsOutlinedIcon,
  repertoire: LibraryMusicOutlinedIcon,
  network: ContactsOutlinedIcon,
}

export function getAchievementIcon(
  key: AchievementKey,
  category: AchievementCategory,
): SvgIconComponent {
  return ACHIEVEMENT_KEY_ICONS[key] ?? ACHIEVEMENT_CATEGORY_ICONS[category] ?? EmojiEventsOutlinedIcon
}
