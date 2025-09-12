'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from './search-input';
import { ListItem } from './list-item';
import { ListSkeleton } from './list-skeleton';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';

interface HierarchyListProps<T> {
  title: string;
  items: T[];
  selectedId: number | null;
  loading: boolean;
  hasNextPage: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onItemSelect: (item: T) => void;
  onLoadMore: () => void;
  getItemId: (item: T) => number;
  getItemTitle: (item: T) => string;
  getItemSubtitle?: (item: T) => string;
  getItemCs?: (item: T) => number | null | undefined;
  emptyMessage?: string;
}

export function HierarchyList<T>(props: HierarchyListProps<T>) {
  const {
    title,
    items,
    selectedId,
    loading,
    hasNextPage,
    searchQuery,
    onSearchChange,
    onItemSelect,
    onLoadMore,
    getItemId,
    getItemTitle,
    getItemSubtitle,
    getItemCs,
    emptyMessage = 'Нет данных',
  } = props;

  const { loadMoreRef } = useInfiniteScroll({ loading, hasNextPage, onLoadMore });

  return (
    <Card className="h-full flex flex-col text-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <SearchInput value={searchQuery} onChange={onSearchChange} placeholder={`Поиск`} />
      </CardHeader>

      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full">
          <div className="p-2 pt-0">
            {loading && items.length === 0 ? (
              <ListSkeleton />
            ) : items.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">{emptyMessage}</div>
            ) : (
              <>
                <div className="rounded-md border border-border overflow-hidden">
                  <ul className="divide-y divide-border">
                    {items.map((item) => {
                      const id = getItemId(item);
                      const isSelected = id === selectedId;
                      const cs = getItemCs?.(item) ?? null;

                      return (
                        <li key={id}>
                          <ListItem
                            title={getItemTitle(item)}
                            subtitle={getItemSubtitle?.(item)}
                            cs={cs}
                            isSelected={isSelected}
                            onClick={() => {
                              if (!isSelected) onItemSelect(item);
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div ref={loadMoreRef} className="py-2">
                  {loading && items.length > 0 && (
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  )}
                  {hasNextPage && !loading && (
                    <div className="flex justify-center mt-3">
                      <Button variant="outline" size="sm" onClick={onLoadMore}>
                        Загрузить ещё
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
