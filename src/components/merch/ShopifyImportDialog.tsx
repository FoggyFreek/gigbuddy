import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import { Link as RouterLink } from 'react-router'
import type { Product } from '../../types/entities.ts'
import { ShopifyImportDoneStep } from './shopifyImportDialog/ShopifyImportDoneStep.tsx'
import { ShopifyOrderMapStep } from './shopifyImportDialog/ShopifyOrderMapStep.tsx'
import { ShopifyOrderSelectStep } from './shopifyImportDialog/ShopifyOrderSelectStep.tsx'
import { useShopifyImportDialog } from './useShopifyImportDialog.ts'

interface Props {
  products: Product[]
  onClose: (imported: boolean) => void
}

export default function ShopifyImportDialog({ products, onClose }: Readonly<Props>) {
  const { t } = useTranslation(['merch', 'common'])
  const {
    step,
    orders,
    nextCursor,
    loading,
    loadingMore,
    error,
    notConfigured,
    selected,
    revenueAccounts,
    mappings,
    result,
    selectedOrders,
    importableOrders,
    loadMore,
    toggleOrder,
    goToMap,
    goToSelect,
    selectLineMapping,
    changeVat,
    changeTax,
    runImport,
  } = useShopifyImportDialog(products)

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.shopify.title)}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {!loading && notConfigured && (
          <Alert severity="info">
            <Trans
              t={t}
              i18nKey={$ => $.shopify.notConnected}
              components={{ settingsLink: <Link component={RouterLink} to="/settings/integrations" /> }}
            />
          </Alert>
        )}

        {!loading && !notConfigured && step === 'select' && (
          <ShopifyOrderSelectStep
            orders={orders}
            selected={selected}
            onToggle={toggleOrder}
            nextCursor={nextCursor}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        )}

        {step === 'map' && (
          <ShopifyOrderMapStep
            orders={selectedOrders}
            products={products}
            revenueAccounts={revenueAccounts}
            mappings={mappings}
            onMappingSelect={selectLineMapping}
            onVatChange={changeVat}
            onTaxChange={changeTax}
          />
        )}

        {step === 'importing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {step === 'done' && result && <ShopifyImportDoneStep result={result} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>
          {result ? t($ => $.common.actions.close) : t($ => $.common.actions.cancel)}
        </Button>
        {step === 'select' && !notConfigured && (
          <Button variant="contained" disabled={!selected.size} onClick={goToMap}>
            {t($ => $.shopify.next, { count: selected.size })}
          </Button>
        )}
        {step === 'map' && (
          <>
            <Button onClick={goToSelect}>{t($ => $.common.actions.back)}</Button>
            <Button
              variant="contained"
              disabled={importableOrders.length !== selectedOrders.length}
              onClick={runImport}
            >
              {t($ => $.shopify.importLines, { count: importableOrders.length })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
