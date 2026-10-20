import { Table } from "antd";
import type { TableProps } from "antd";

/**
 * 分页表格壳（第 73 步片二归一）：分页只有三式，且必须显式选式——
 * ① 服务端分页（唯一默认形态）：serverPage 传 current/pageSize/total/onChange，
 *    固定带 showSizeChanger + showTotal「共 N 条」；
 * ② 客户端分页：clientPageSize（缺省 20），形态与①一致（同样带 showTotal）；
 * ③ 不分页：noPagination（详情内嵌子表等场景）。
 * totalText 可覆盖计数文案（如「共 N 个资产」），缺省「共 N 条」。
 */
export interface ServerPage {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
}

export type PageTableProps<RecordType extends object> = Omit<
  TableProps<RecordType>,
  "pagination"
> & {
  serverPage?: ServerPage;
  clientPageSize?: number;
  noPagination?: boolean;
  totalText?: (total: number) => string;
};

export function PageTable<RecordType extends object>(
  props: PageTableProps<RecordType>,
) {
  const { serverPage, clientPageSize, noPagination, totalText, ...rest } =
    props;
  const showTotal = (t: number) => (totalText ? totalText(t) : `共 ${t} 条`);
  const pagination: TableProps<RecordType>["pagination"] = noPagination
    ? false
    : serverPage
      ? {
          current: serverPage.current,
          pageSize: serverPage.pageSize,
          total: serverPage.total,
          showSizeChanger: true,
          showTotal,
          onChange: serverPage.onChange,
        }
      : {
          pageSize: clientPageSize ?? 20,
          showSizeChanger: true,
          showTotal,
        };
  return <Table<RecordType> {...rest} pagination={pagination} />;
}
