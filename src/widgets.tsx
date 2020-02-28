import {
  registerWidgetManager,
  WidgetRenderer
} from "@jupyter-widgets/jupyterlab-manager";
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from "@jupyterlab/application";
import {
  ReactWidget,
  WidgetTracker,
  MainAreaWidget
} from "@jupyterlab/apputils";
import { IDocumentManager } from "@jupyterlab/docmanager";
import { Context } from "@jupyterlab/docregistry";
import { INotebookModel, INotebookTracker } from "@jupyterlab/notebook";
import { IRenderMimeRegistry } from "@jupyterlab/rendermime";
import { IRenderMime } from "@jupyterlab/rendermime-interfaces";
import * as React from "react";

const MIME_TYPE = "application/x.jupyterlab.widget+json";

const WIDGETS_MIME_TYPE = "...";

const OPEN_WIDGET_COMMAND = "ipywidgets:open";
const NAMESPACE = "ipywidgets";

async function getContext(
  docmanager: IDocumentManager,
  path: string,
  factoryName: string
): Promise<Context<any>> {
  // The doc manager doesn't expose a way to get a context without also opening a widget, so we have to duplicate some
  // logic from `_createOrOpenDocument` and use private methods.
  let context: Context<INotebookModel> = (docmanager as any)._findContext(
    path,
    factoryName
  );
  if (!context) {
    context = (docmanager as any)._createContext(
      path,
      docmanager.registry.getModelFactory(factoryName),
      docmanager.registry.getKernelPreference(path, "Kernel")
    );
    await context.initialize(false);
  }
  return context;
}

/**
 * extends WidgetRenderer to expose document path and widget data so it can be restored
 */
class RenderedWidget extends WidgetRenderer {
  constructor(
    public options: {
      rendermime: IRenderMimeRegistry;
      notebook: string;
      data: any;
      docmanager: IDocumentManager;
    }
  ) {
    super({
      mimeType: WIDGETS_MIME_TYPE,
      resolver: options.rendermime.resolver,
      linkHandler: options.rendermime.linkHandler,
      latexTypesetter: options.rendermime.latexTypesetter,
      sanitizer: options.rendermime.sanitizer
    });
    this.title.label = "IPyWidget";
    this.renderModel({
      data: {
        [WIDGETS_MIME_TYPE]: options.data
      },
      trusted: true,
      metadata: {},
      setData: () => null
    });

    getContext(options.docmanager, options.notebook, "notebook").then(context =>
      registerWidgetManager(
        context,
        options.rendermime,
        [this][Symbol.iterator]()
      )
    );
  }
}

function Component({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <button onClick={() => onClick()}>Open widget</button>
    </div>
  );
}

class PyWidgetOutput extends ReactWidget implements IRenderMime.IRenderer {
  constructor(
    public readonly options: {
      app: JupyterFrontEnd;
      notebook: string;
    }
  ) {
    super();
  }
  /**
   * Render typez-graph into this widget's node.
   */
  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    this.data = model.data[MIME_TYPE];
  }

  render() {
    return <Component onClick={() => this.onClick()} />;
  }
  async onClick() {
    const { app, notebook } = this.options;
    const data = this.data;
    app.commands.execute(OPEN_WIDGET_COMMAND, { notebook, data });
  }
  public data = {};
}

const extension: JupyterFrontEndPlugin<void> = {
  id: "jupyter-widgets-takeover:widgets",
  autoStart: true,
  requires: [
    IRenderMimeRegistry,
    IDocumentManager,
    ILayoutRestorer,
    INotebookTracker
  ],

  activate: (
    app: JupyterFrontEnd,
    rendermime: IRenderMimeRegistry,
    docmanager: IDocumentManager,
    restorer: ILayoutRestorer,
    notebook: INotebookTracker
  ) => {
    const tracker = new WidgetTracker<MainAreaWidget<RenderedWidget>>({
      namespace: NAMESPACE
    });
    app.commands.addCommand(OPEN_WIDGET_COMMAND, {
      execute: ({ notebook, data }) => {
        const widget = new RenderedWidget({
          rendermime,
          notebook: notebook as string,
          data,
          docmanager
        });

        const mainWidget = new MainAreaWidget({ content: widget });
        tracker.add(mainWidget);
        app.shell.add(mainWidget, "main");
      }
    });
    restorer.restore(tracker, {
      command: OPEN_WIDGET_COMMAND,
      args: ({ content }) => ({
        data: content.options.data,
        notebook: content.options.notebook
      }),
      name: ({ content }) =>
        `${content.options.notebook}:${content.options.data.model_id}`
    });
    notebook.widgetAdded.connect((_, panel) => {
      panel.content.rendermime.addFactory({
        safe: true,
        mimeTypes: [MIME_TYPE],
        createRenderer: () =>
          new PyWidgetOutput({ app, notebook: panel.context.path })
      });
    });
  }
};

export default extension;
