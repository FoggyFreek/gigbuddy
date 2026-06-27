import TablePagination, { type TablePaginationProps } from '@mui/material/TablePagination'

type ListPaginationProps = Pick<
  TablePaginationProps,
  'count' | 'page' | 'rowsPerPage' | 'onPageChange' | 'onRowsPerPageChange' | 'rowsPerPageOptions' |
  'labelRowsPerPage' | 'labelDisplayedRows' | 'getItemAriaLabel'
>

// The standard `component="div"` list pagination, docked to the bottom of its
// scroll container (the split-view pane bounded to the screen height, or the
// window) so the rows scroll underneath it and the controls stay on-screen no
// matter how long the list gets. Place it as the last child of the list's
// <Paper>, after the <TableContainer>.
export default function ListPagination(props: ListPaginationProps) {
  return (
    <TablePagination
      component="div"
      sx={{
        position: 'sticky',
        bottom: 0,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        zIndex: 1,
      }}
      {...props}
    />
  )
}
