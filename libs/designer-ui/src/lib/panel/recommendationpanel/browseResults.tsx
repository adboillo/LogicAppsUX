import NoResultsSvg from '../../../assets/search/noResults.svg';
import { ConnectorSummaryCard } from '../../connectorsummarycard';
import { getConnectorCategoryString } from '../../utils';
import { List } from '@fluentui/react';
import { Spinner, Text } from '@fluentui/react-components';
import type { Connector } from '@microsoft/logic-apps-shared';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

export type BrowseGridProps = {
  onConnectorSelected: (connectorId: string) => void;
  connectors: Connector[];
  isLoading: boolean;
  displayRuntimeInfo: boolean;
};

export const BrowseGrid = (props: BrowseGridProps) => {
  const { connectors, onConnectorSelected, isLoading, displayRuntimeInfo } = props;

  const intl = useIntl();
  const ref = useRef(null);
  const [forceSingleCol, setForceSingleCol] = useState(false);

  const checkCol = useCallback(() => {
    setForceSingleCol((ref.current as any)?.clientWidth < 560);
  }, []);
  window.onresize = checkCol;
  useLayoutEffect(checkCol, [checkCol]);

  const onRenderCell = useCallback(
    (connector?: Connector, _index?: number) => {
      if (!connector) {
        return;
      }
      return (
        <div className="mlsa-browse-list-tile-wrapper">
          <div className="msla-browse-list-tile" style={{ width: forceSingleCol ? '100%' : '50%' }}>
            <ConnectorSummaryCard
              key={connector.id}
              connector={connector}
              onClick={onConnectorSelected}
              category={getConnectorCategoryString(connector)}
              displayRuntimeInfo={displayRuntimeInfo}
            />
          </div>
        </div>
      );
    },
    [forceSingleCol, onConnectorSelected, displayRuntimeInfo]
  );

  const noResultsText = intl.formatMessage({
    defaultMessage: 'No results found for the specified filters',
    id: 'w0pI5M',
    description: 'Text to show when there are no browse results with the given filters',
  });

  const loadingText = intl.formatMessage({
    defaultMessage: 'Loading all connectors...',
    id: 'OOUTdW',
    description: 'Message to show under the loading icon when loading connectors',
  });

  if (!isLoading && connectors.length === 0) {
    return (
      <div className="msla-no-results-container">
        <img src={NoResultsSvg} alt={noResultsText?.toString()} />
        <Text>{noResultsText}</Text>
      </div>
    );
  }

  return (
    <div ref={ref} className="msla-browse-list">
      {isLoading && (
        <div style={{ marginBottom: '16px' }}>
          <Spinner size="extra-small" label={loadingText} aria-live="assertive" />
        </div>
      )}
      <List onRenderCell={onRenderCell} items={connectors} getPageHeight={() => (forceSingleCol ? 80 * 10 : 80 * 5)} />
    </div>
  );
};
